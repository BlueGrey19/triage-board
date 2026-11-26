/**
 * GitHub storage backend: the signed-in user's private data repo.
 *
 *   <owner>/<repo>
 *   ├── board.json          projects + triage items
 *   └── snippets/<id>.md    one markdown file per snippet
 *
 * Every change is a commit, so you get full history and rollback for free.
 * Writes pass the file's current SHA, so a stale write is rejected by GitHub
 * instead of silently overwriting a newer version.
 */

const { request, graphql, GitHubError } = require('./github');
const { normalizeBoard, normalizeArchive, serializeSnippet, parseSnippet } = require('./model');

const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const unb64 = s => Buffer.from(s || '', 'base64').toString('utf8');

function createGithubStore({ token, owner, repo, seed }) {
  const base = '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/contents/';
  const url = p => base + p.split('/').map(encodeURIComponent).join('/');

  async function readFile(path) {
    try {
      const f = await request(token, 'GET', url(path));
      return { text: unb64(f.content), sha: f.sha };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  function writeFile(path, text, sha, message) {
    const body = { message, content: b64(text) };
    if (sha) body.sha = sha;
    return request(token, 'PUT', url(path), body);
  }

  const seedBoard = () => normalizeBoard(JSON.parse(JSON.stringify(seed)));
  const normalizeOrSeed = raw => (raw ? normalizeBoard(raw) : seedBoard());

  // Read-modify-write with optimistic locking; retries if someone else
  // (another tab, another device) committed in between. Also covers a
  // write that went through but whose reply was lost: the retry sees a
  // conflict, re-reads, and the change is already there (no-op below).
  // writeIfMissing: write even when unchanged if the file doesn't exist yet
  // (the board seeds itself; the archive stays absent until it has content).
  async function mutateJson(file, norm, fn, message, fallbackMsg, writeIfMissing) {
    for (let attempt = 0; ; attempt++) {
      const f = await readFile(file);
      const data = norm(f ? JSON.parse(f.text) : null);
      const before = JSON.stringify({ ...data, updatedAt: null });
      const result = fn(data);
      // Nothing changed (e.g. a change that was already saved): skip the empty commit.
      if ((f || !writeIfMissing) && JSON.stringify({ ...data, updatedAt: null }) === before) return result;
      data.updatedAt = new Date().toISOString();
      try {
        // The message can depend on the change, e.g. the title of the item changed.
        const msg = typeof message === 'function' ? message(result) : message;
        await writeFile(file, JSON.stringify(data, null, 2) + '\n', f && f.sha, msg || fallbackMsg);
        return result;
      } catch (e) {
        const conflict = e.status === 409 || (e.status === 422 && /sha/i.test(e.message));
        if (!conflict || attempt >= 2) throw e;
      }
    }
  }

  return {
    label: owner + '/' + repo,

    async getBoard() {
      const f = await readFile('board.json');
      return f ? normalizeBoard(JSON.parse(f.text)) : seedBoard();
    },

    async getArchive() {
      const f = await readFile('archive.json');
      return normalizeArchive(f ? JSON.parse(f.text) : null);
    },

    mutateBoard: (fn, message) => mutateJson('board.json', normalizeOrSeed, fn, message, 'Update board', true),

    // The archive file only comes into being once something is archived.
    mutateArchive: (fn, message) => mutateJson('archive.json', normalizeArchive, fn, message, 'Update archive', false),

    // One GraphQL call fetches every snippet file's contents at once.
    async listSnippets() {
      const data = await graphql(token,
        `query($owner:String!,$name:String!){
          repository(owner:$owner,name:$name){
            object(expression:"HEAD:snippets"){
              ... on Tree { entries { name type object { ... on Blob { text } } } }
            }
          }
        }`, { owner, name: repo });
      const tree = data && data.repository && data.repository.object;
      if (!tree || !tree.entries) return [];
      return tree.entries
        .filter(e => e.type === 'blob' && e.name.endsWith('.md') && e.object && e.object.text != null)
        .map(e => parseSnippet(e.name.slice(0, -3), e.object.text));
    },

    async getSnippet(id) {
      const f = await readFile('snippets/' + id + '.md');
      return f ? { snippet: parseSnippet(id, f.text), version: f.sha } : null;
    },

    async putSnippet(snippet, version, message) {
      const text = serializeSnippet(snippet);
      try {
        await writeFile('snippets/' + snippet.id + '.md', text, version, message);
      } catch (e) {
        if (e.status === 409 || e.status === 422) {
          // A retried write whose first attempt already went through: the
          // file already holds exactly what we meant to write.
          const now = await readFile('snippets/' + snippet.id + '.md');
          if (now && now.text === text) return;
          throw new GitHubError(409, 'This snippet changed somewhere else. Reload and try again.');
        }
        throw e;
      }
    },

    async deleteSnippet(id, message) {
      const f = await readFile('snippets/' + id + '.md');
      if (!f) return false;
      await request(token, 'DELETE', url('snippets/' + id + '.md'), { message, sha: f.sha });
      return true;
    }
  };
}

module.exports = { createGithubStore };
