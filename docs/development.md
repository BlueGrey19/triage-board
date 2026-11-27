# Development

How the code is laid out, how saving works, and how to test changes. Back to the
[README](../README.md).

- [Running it](#running-it)
- [Project structure](#project-structure)
- [How saving works](#how-saving-works)
- [Testing](#testing)
- [Adding a feature](#adding-a-feature)

---

## Running it

```bash
npm install
npm start          # http://localhost:4317
```

In VS Code you can also press **F5**. The included launch config starts the server.
Without `GITHUB_CLIENT_ID` set, it runs in local mode and saves to `data/`. For GitHub
mode, see [GitHub setup](github-setup.md).

## Project structure

```
triage-board/
├── server.js              Express server: auth, API, picks storage backend
├── lib/
│   ├── model.js           item / snippet / archive validation, stages, snippet file format
│   ├── store-local.js     local-mode storage (data/ folder)
│   ├── store-github.js    GitHub-mode storage (Contents + GraphQL APIs)
│   ├── github.js          GitHub login + API client (built-in fetch, no SDK)
│   ├── session.js         encrypted cookie sessions
│   └── env.js             tiny .env loader
├── public/                the UI (index.html, styles.css, app.js); no build step
├── test/
│   ├── unit/              fast Node tests (npm test)
│   ├── e2e/               browser tests (npm run test:e2e)
│   └── helpers/           in-memory fake of GitHub for the tests
├── data/
│   ├── seed.json          starter projects for a brand-new board
│   ├── board.json         local-mode board (git-ignored)
│   ├── archive.json       local-mode archive (git-ignored)
│   └── snippets/          local-mode snippets (git-ignored)
├── docs/                  this guide, the user guide and GitHub setup
├── .env.example           copy to .env for GitHub mode
├── playwright.config.js   browser test settings
├── .vscode/launch.json    press F5 to run
├── LICENSE
└── README.md
```

## How saving works

### In the browser (`public/app.js`)

- Every change is an **op** (`{ t, m, u, b, k }`: type, HTTP method, URL, body, key)
  passed to `change(op)`. It's applied to the screen straight away by `applyOp`, added
  to a **queue in localStorage**, and sent to the server in order.
- Failed sends are retried with backoff (2s doubling up to 60s). Only one tab sends at a
  time (`navigator.locks`). Changes that can never succeed (e.g. the item was deleted
  elsewhere) are dropped with a message.
- After every reload, still-queued ops are applied again on top of the fresh data, so
  **`applyOp` must be idempotent**: applying an op twice must give the same result.
- New items, steps and snippets get their **ids in the browser** (`'i-' + rid()`,
  `'s-' + rid()`), so they can be shown and changed before they're saved.
- The last loaded board, snippets and archive are cached in localStorage, so the app
  can open offline.

### On the server (`server.js`)

- Every route must be **safe to retry**, because the browser re-sends a request whose
  reply was lost. Adding something whose id already exists returns it unchanged;
  deleting something already gone succeeds.
- Storage goes through a store (`lib/store-local.js` or `lib/store-github.js`) with the
  same interface: `getBoard` / `mutateBoard(fn, message)`, `getArchive` /
  `mutateArchive`, and the snippet functions.
- In GitHub mode each `mutate…` call is **one commit**. It re-reads the file, applies
  `fn`, and writes with the file's SHA (optimistic locking, retried on conflict). If
  `fn` changed nothing, nothing is written, so retries don't make empty commits. The
  commit message can be a function of the result.
- **Moves between files** (archive, restore, close project, stage moves) always write
  `archive.json` first and `board.json` second. If the connection drops in between,
  the worst case is a duplicate that the retry cleans up, never a lost item.
- Network blips to GitHub are retried twice (`lib/github.js`), then reported as a
  503 with `code: "network"`, which the browser treats as "retry later".

## Testing

```
npm test             # fast Node tests (a few seconds, no extra setup)
npm run test:e2e     # browser tests (a few minutes)
npm run test:all     # both
```

- `npm test` (`test/unit/`, Node's built-in test runner) covers the data rules
  (validation, stages, snippet files), local storage, the GitHub client's retries, and
  the API routes' commits against an in-memory fake of GitHub
  (`test/helpers/fake-github.js`).
- `npm run test:e2e` (`test/e2e/`, Playwright) drives the real app in a browser: saving
  and retrying, offline, undo, steps, archive, project stages, quick add and snippet
  links. Each spec starts its own server on a free port with a temporary data folder.
  It uses Microsoft Edge on Windows. Elsewhere, run `npx playwright install chromium`
  once and set `PW_CHANNEL=chromium`.
- The tests set `TRIAGE_NO_DOTENV=1`, use temporary data folders and a fake GitHub, so
  they never touch `data/`, `.env` or the real GitHub.
- A failing browser run leaves a report with a screenshot and trace:
  `npx playwright show-report`.

## Adding a feature

1. Data rules go in `lib/model.js`; old boards and snippet files must keep loading
   unchanged.
2. New routes go in `server.js`: make them safe to retry, give commits a clear message,
   and write `archive.json` before `board.json` for any move.
3. In `public/app.js`, make changes through `change(op)` and handle the op in an
   idempotent `applyOp`, so it works offline.
4. Add tests: unit tests for model and route behaviour (including commit counts against
   the fake GitHub), and an e2e spec or steps for the UI, including the offline case.
5. Update the [user guide](user-guide.md), and the README if it changes setup.
