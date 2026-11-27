# Triage Board

A **to-do triage board** with a built-in **code snippet library**, in light and dark mode.

- **Board:** items sit in four priority columns (**Critical / High / Medium / Low**),
  each tagged with its project and groups. Filter by project, group, status or search
  to see one client's pile at a glance, even when you're juggling several. Paste a list
  to add many items at once, break items into checklists, move projects through
  delivery stages, and archive finished work.
- **Snippets:** your reusable code (Deluge, JS, SQL, and others) in a two-pane library
  with search, tags, syntax highlighting and one-click copy, linked to the items and
  projects they were used for, so you stop rewriting the same thing for every client.

It runs in one of two modes:

| | **Local mode** (default) | **GitHub mode** |
|---|---|---|
| Login | none | "Sign in with GitHub" |
| Where data lives | `data/` folder on your machine | a private repo in *your* GitHub account |
| Undo last change | yes | yes |
| Full history | no | every change is a git commit |
| Works offline | yes | yes, changes sync when you're back |
| Multi-device / phone | no | yes, if you host it |
| Multi-user | no | yes, each person gets their own repo |
| Setup | `npm start` | create a GitHub App (about 5 minutes) |

## Quick start (local mode)

Needs [Node.js](https://nodejs.org) 18 or newer (`node --version`).

```bash
npm install
npm start
```

Open http://localhost:4317. Your board saves to `data/board.json`, archived items to
`data/archive.json` and snippets to `data/snippets/*.md`. All are git-ignored, so
pushing this repo never uploads your data.

## Documentation

| Guide | What's in it |
|---|---|
| [User guide](docs/user-guide.md) | The board, quick add, checklists, undo, project stages, archive, snippets, saving offline and keyboard shortcuts |
| [GitHub setup](docs/github-setup.md) | Signing in with GitHub, your `triage-data` repo, all settings, hosting it for your phone, letting friends use it |
| [Development](docs/development.md) | Project structure, how saving and sync work, running the tests, adding a feature |

## Troubleshooting

- **Label says "Can't reach the server · retrying"**: the `npm start` terminal was
  closed or crashed. Start it again; waiting changes save on their own.
- **Label says "Not synced · retrying"** in GitHub mode: GitHub couldn't be reached.
  Your changes are kept and retried; click the label to retry now.
- **Port already in use**: `PORT=8080 npm start` (and update `BASE_URL` to match).
- **GitHub sign-in problems**: see [GitHub setup → Troubleshooting](docs/github-setup.md#troubleshooting).

## License

MIT. See [LICENSE](LICENSE).
