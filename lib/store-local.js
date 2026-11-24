/**
 * Local storage backend: data/board.json plus data/snippets/*.md on disk.
 * Used when no GitHub App is configured. No login, single user.
 */

const fs = require('fs');
const path = require('path');
const { normalizeBoard, serializeSnippet, parseSnippet } = require('./model');

function createLocalStore({ dataDir, seed }) {
  const boardFile = path.join(dataDir, 'board.json');
  const snipDir = path.join(dataDir, 'snippets');

  // Atomic write: temp file then rename, so a crash mid-write can't corrupt.
  function writeAtomic(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, file);
  }

  function readBoard() {
    try {
      return normalizeBoard(JSON.parse(fs.readFileSync(boardFile, 'utf8')));
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('Could not read board.json:', e.message);
      return normalizeBoard(JSON.parse(JSON.stringify(seed)));
    }
  }

  function writeBoard(board) {
    board.updatedAt = new Date().toISOString();
    writeAtomic(boardFile, JSON.stringify(board, null, 2));
  }

  if (!fs.existsSync(boardFile)) {
    writeBoard(readBoard());
    console.log('  Created a fresh board at', boardFile);
  }

  const snipFile = id => path.join(snipDir, id + '.md');

  return {
    label: dataDir,

    async getBoard() { return readBoard(); },

    async mutateBoard(fn) {
      const board = readBoard();
      const result = fn(board);
      writeBoard(board);
      return result;
    },

    async listSnippets() {
      if (!fs.existsSync(snipDir)) return [];
      return fs.readdirSync(snipDir)
        .filter(f => f.endsWith('.md'))
        .map(f => parseSnippet(f.slice(0, -3), fs.readFileSync(path.join(snipDir, f), 'utf8')));
    },

    async getSnippet(id) {
      try {
        return { snippet: parseSnippet(id, fs.readFileSync(snipFile(id), 'utf8')), version: null };
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    },

    async putSnippet(snippet) {
      writeAtomic(snipFile(snippet.id), serializeSnippet(snippet));
    },

    async deleteSnippet(id) {
      try { fs.unlinkSync(snipFile(id)); return true; }
      catch (e) { if (e.code === 'ENOENT') return false; throw e; }
    }
  };
}

module.exports = { createLocalStore };
