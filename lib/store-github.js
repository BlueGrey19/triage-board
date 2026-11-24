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
const { normalizeBoard, serializeSnippet, parseSnippet } = require('./model');

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

  return {
    label: owner + '/' + repo,

    async getBoard() {
      const f = await readFile('board.json');
      return f ? normalizeBoard(JSON.parse(f.text)) : seedBoard();
    },

    // Read-modify-write with optimistic locking; retries if someone else
    // (another tab, another device) committed in between.
    async mutateBoard(fn, message) {
      for (let attempt = 0; ; attempt++) {
        const f = await readFile('board.json');
        const board = f ? normalizeBoard(JSON.parse(f.text)) : seedBoard();
        const result = fn(board);
        board.updatedAt = new Date().toISOString();
        try {
          await writeFile('board.json', JSON.stringify(board, null, 2) + '\n', f && f.sha, message || 'Update board');
          return result;
        } catch (e) {
          const conflict = e.status === 409 || (e.status === 422 && /sha/i.test(e.message));
          if (!conflict || attempt >= 2) throw e;
        }
      }
    },

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
      try {
        await writeFile('snippets/' + snippet.id + '.md', serializeSnippet(snippet), version, message);
      } catch (e) {
        if (e.status === 409 || e.status === 422) {
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
