# Triage Board

A **to-do triage board** with a built-in **code snippet library**, in light and dark mode.

- **Board:** items sit in four priority columns (**Critical / High / Medium / Low**),
  each tagged with its project and groups. Filter by project, group, status or search
  to see one client's pile at a glance, even when you're juggling several. Break items
  into checklists, move projects through delivery stages, and archive finished work.
- **Snippets:** your reusable code (Deluge, JS, SQL, and others) in a two-pane library
  with search, tags, syntax highlighting and one-click copy, so you stop rewriting the
  same thing for every client.

It runs in one of two modes:

| | **Local mode** (default) | **GitHub mode** |
|---|---|---|
| Login | none | "Sign in with GitHub" |
| Where data lives | `data/` folder on your machine | a private repo in *your* GitHub account |
| Undo last change | yes | yes |
| Full history | no | every change is a git commit |
| Multi-device / phone | no | yes, if you host it |
| Multi-user | no | yes, each person gets their own repo |
| Setup | `npm start` | create a GitHub App (about 5 minutes) |

---

## Features

### Board

- **Four priority columns** side by side (2×2 on smaller screens, stacked on phones).
  Change an item's priority from its `⋯` menu, or **drag the card** to another column.
- **Slim cards.** Click a card to open it and see its description, change its status,
  edit or delete it. Cards with a description show a small ≡ icon after the title.
- **Status per item:** Open, Doing, Testing, Blocked, Done. Click the status pill on a
  card to change it. Done items fold away under "✓ N done" in each column, and the item
  remembers the date it was marked done.
- **Quick add** (or press `Q`): paste a list, such as a client's email of amendments,
  and each line becomes an item. Bullets and numbering are stripped, and indented lines
  become checklist steps of the item above:

  ```
  - Fix login redirect
      - Check callback URL
  - Update invoice template
  ```

  Set the project, priority and group once for the batch, edit or remove anything in the
  preview, then add up to 100 items as one change (one commit in GitHub mode).
- **Checklists:** break an item into steps from its popup. Type a step and press Enter
  to add it, tick it off, click its text to edit it, or remove it with ×. Cards show
  progress as `☑ 2/5`, and search finds step text too. Status stays manual.
- **Undo:** after changing an item's status, priority, project or stage, or saving an
  edit, a message offers **Undo** for a few seconds (or press `Ctrl+Z`). Deletes still
  ask first instead.
- **Linked snippets:** link the code you used to an item from its popup (**Link
  snippet**). Cards show a link count, and clicking a linked snippet opens it.
- **Cards or Compact view.** Compact shows one line per item. Your choice is remembered.
- **Sidebar filters** for priority, project and group, plus a **group filter** and
  **search** on the board itself. They combine (e.g. Project: Milltrans + Group: Books),
  and every active filter shows as a removable chip under the title.
- **Status pills** in the header show counts and work as filters too, next to a
  progress bar with the done percentage.
- **Groups:** give an item several, separated by commas (`Books, Reporting tags`). Each
  shows as its own chip; click one to filter by it.
- **Projects** are managed from **Manage** in the sidebar. Give each one an **accent
  colour** from a preset palette: its view takes on that colour, and its chip shows in
  that colour on every card.

### Project stages

Every project moves through the same delivery stages:

| Stage | Suggested groups |
|---|---|
| Implementation | Development, Configuration |
| Go Live | Training, Customer Testing, Defect Resolution |
| Acceptance | Final Review, Project Closure |
| Hypercare | User Onboarding, Support Takeover |

- Filter the board to a project to see its **stage track** and a **Move to <next stage>**
  button. The sidebar shows each project's current stage.
- **Moving forward** archives the project's done items from earlier stages. Unfinished
  items stay on the board with a small chip showing the stage they came from.
- **Stepping back:** click an earlier stage on the track. Nothing is archived.
- New items take the project's current stage; change an item's stage in its edit popup.
  The Group field suggests the stage's activities first.
- On Hypercare the button becomes **Close project**.

### Archive

- **Archive done** (next to the search box) archives the done items the current filters
  show, e.g. everything done in Project: Milltrans + Group: Development.
- **Archive one item** from its `⋯` menu or popup, with Undo.
- **Close project** (from the stage track on Hypercare, or **Manage** in the sidebar)
  moves all of a project's items to the archive and takes the project off the board.
- The **Archive** page lists archived items with search and project, group and stage
  filters. **Restore** puts an item back exactly as it was; **Reopen project** brings
  back a closed project with all its items.

### Snippets

- **Two-pane library:** a searchable list on the left; the selected snippet on the right
  with line numbers, syntax highlighting (including Deluge) and one-click copy.
- Each snippet has a title, language, **Used in** (e.g. Workflow function, Webhook,
  Client script), tags, **projects**, description and code.
- **Filters** sit on one row: Used in and Project dropdowns, the most-used tags, and
  **More tags** to search every tag. Type `#tag` in the search box to filter by a tag
  (e.g. `#books invoice`). Active filters show as removable chips.
- **Links to the board:** a snippet's **Used for** list shows the items it's linked to
  (archived ones too), and **Link to item** links one from this side. A snippet can also
  belong to projects directly, e.g. a client's API helper. Filter the board to a project
  and its **Snippets** button lists everything linked to it, directly or through its items.

### General

- **Light, dark or auto theme** (follows your system), switchable in the sidebar.
- **Works on phones:** the sidebar becomes a slide-out menu.
- **Saves in the background.** Every change shows immediately and is saved behind the
  scenes. The label next to the page title shows the state: *Synced to GitHub* /
  *Saved locally*, *Saving…*, or *Not synced · N changes · retrying*.
- **Keeps working when the connection drops.** Unsaved changes are kept in the browser
  (they survive a refresh) and retried until they save, one GitHub commit each. Click
  the label to retry straight away. If the app is opened while GitHub can't be reached,
  it shows your last saved copy of the board, snippets and archive.

### Keyboard shortcuts

| Key | Does |
|---|---|
| `/` | Jump to search (board or snippets) |
| `N` | Add a new board item |
| `Q` | Quick add: paste a list of items |
| `Ctrl+Z` | Undo the last change while its message is showing (not while typing) |
| `Esc` | Close the open menu or window, or clear the search box |
| `↑` `↓` `Enter` | Move through and pick from menus, dropdowns and suggestions |

---

## Requirements

[Node.js](https://nodejs.org) 18 or newer (`node --version`).

## Quick start (local mode)

```bash
npm install
npm start
```

Open http://localhost:4317. Your board saves to `data/board.json`, archived items to
`data/archive.json` and snippets to `data/snippets/*.md`. All are git-ignored, so
pushing this repo never uploads your data.

In VS Code you can also press **F5**. The included launch config starts the server.

---

## GitHub mode (sign in with GitHub, data in your own private repo)

### How it works

- You sign in with a **GitHub App**. Its login token only works on repos the app is
  **installed on**, so the board can touch your `triage-data` repo and nothing else:
  not your work repos or any other private code. (An OAuth App would need the `repo`
  scope, which grants access to *every* private repo you own.)
- The login code is exchanged for a token on the server, so the client secret
  never reaches the browser. The token is kept in an encrypted, HttpOnly cookie.
- Each user's data lives in **their own** private repo:

  ```
  <your-username>/triage-data
  ├── board.json              projects (colours, stages) + triage items and checklists
  ├── archive.json            archived items and closed projects (made on first archive)
  └── snippets/
      ├── books-create-invoice-a1b2.md
      └── ...                 one readable markdown file per snippet
  ```

  A snippet file starts with a short header (title, language, optional `type` for
  "Used in", tags, optional `projects`, dates), followed by the description and the
  code block. Links from items to snippets are stored on the items in `board.json`.

  Each change is a commit (`Add item: …`, `Tick step: …`, `Link snippet: …`,
  `Move Milltrans to Go Live`),
  so you can view history, diff and roll back on github.com. Archiving writes
  `archive.json` first and then `board.json` (two commits), so an interrupted move can
  never lose an item. You can also hand-edit snippet files
  there; the app picks them up.

### 1. Create the GitHub App

GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**
([direct link](https://github.com/settings/apps/new)).

| Field | Value |
|---|---|
| GitHub App name | anything, e.g. `my-triage-board` |
| Homepage URL | `http://localhost:4317` (or your hosted URL) |
| Callback URL | `http://localhost:4317/auth/callback` |
| Expire user authorization tokens | ✅ leave on |
| Request user authorization (OAuth) during installation | optional |
| Webhook → Active | ❌ **untick** (not needed) |
| Repository permissions → **Contents** | **Read and write** |
| *All other permissions* | No access |
| Where can this GitHub App be installed? | *Only on this account* (or *Any account* if friends will use it) |

Click **Create GitHub App**, then on the app's page:

- Copy the **Client ID**.
- Click **Generate a new client secret** and copy it.
- Note the app's URL name (the `my-triage-board` part of `github.com/apps/my-triage-board`).

### 2. Create your data repo and install the app on it

1. [Create a **private** repo](https://github.com/new?name=triage-data&visibility=private)
   named `triage-data`. Leave it empty.
2. Go to `https://github.com/apps/<your-app-name>` → **Install** → choose
   **Only select repositories** → pick `triage-data`.

If you skip this step, the app shows you these same two steps after you sign in.

### 3. Configure and run

```bash
cp .env.example .env
```

Fill in `.env`:

```ini
BASE_URL=http://localhost:4317
GITHUB_CLIENT_ID=Iv23li...
GITHUB_CLIENT_SECRET=...
GITHUB_APP_SLUG=my-triage-board
SESSION_SECRET=<output of the command below>
```

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm start
```

Open http://localhost:4317 and click **Sign in with GitHub**.

### All settings

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `4317` | Port the server listens on |
| `BASE_URL` | `http://localhost:$PORT` | Public address. Callback is `BASE_URL/auth/callback` |
| `GITHUB_CLIENT_ID` | – | GitHub App client ID. **Setting this turns on GitHub mode** |
| `GITHUB_CLIENT_SECRET` | – | GitHub App client secret |
| `GITHUB_APP_SLUG` | – | App URL name, used for the "Install the app" link |
| `DATA_REPO` | `triage-data` | Name of each user's data repo |
| `SESSION_SECRET` | – | 32+ random chars; encrypts the login cookie (required in GitHub mode) |
| `ALLOWED_USERS` | *(anyone)* | Comma-separated GitHub usernames allowed to sign in |
| `DATA_DIR` | `./data` | Where local mode keeps its files |

### Hosting it (open it on your phone)

Any Node host works (Render, Railway, Fly.io, a VPS). In GitHub mode the server
keeps nothing on disk, so free tiers that wipe the filesystem on restart are fine.

1. Deploy with start command `npm start`.
2. Set the environment variables above on the host. Set `BASE_URL` to the
   `https://…` address. Cookies are automatically marked `Secure` on https.
3. In your GitHub App settings, **add** `https://<your-host>/auth/callback` as a
   second Callback URL (keep the localhost one for local dev).
4. If it's just for you, set `ALLOWED_USERS=<your-username>`.

### Letting friends use it

Set the app to *Any account* and send them the install link
(`https://github.com/apps/<your-app-name>`). Each friend creates their own private
`triage-data` repo, installs the app on it and signs in. They only ever see their
own data, and you never see theirs.

---

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
├── public/                the UI (index.html, styles.css, app.js)
├── test/
│   ├── unit/              fast Node tests (npm test)
│   ├── e2e/               browser tests (npm run test:e2e)
│   └── helpers/           in-memory fake of GitHub for the tests
├── data/
│   ├── seed.json          starter projects for a brand-new board
│   ├── board.json         local-mode board (git-ignored)
│   ├── archive.json       local-mode archive (git-ignored)
│   └── snippets/          local-mode snippets (git-ignored)
├── .env.example           copy to .env for GitHub mode
├── playwright.config.js   browser test settings
├── .vscode/launch.json    press F5 to run
├── LICENSE
└── README.md
```

## Testing

```
npm test             # fast Node tests (a few seconds, no extra setup)
npm run test:e2e     # browser tests (a few minutes)
npm run test:all     # both
```

- `npm test` covers the data rules (validation, stages, snippet files), local storage,
  the GitHub client's retries, and the API routes' commits against an in-memory fake
  of GitHub.
- `npm run test:e2e` drives the real app in a browser with Playwright: saving and
  retrying, offline, undo, steps, archive, project stages, quick add and snippet links.
  It uses Microsoft Edge on Windows. Elsewhere, run `npx playwright install chromium`
  once and set `PW_CHANNEL=chromium`.
- The tests use temporary data folders and a fake GitHub. They never touch `data/`,
  `.env` or the real GitHub.
- A failing browser run leaves a report with a screenshot and trace:
  `npx playwright show-report`.

## Troubleshooting

- **Label says "Can't reach the server · retrying"**: the `npm start` terminal was
  closed or crashed. Start it again; waiting changes save on their own.
- **Label says "Not synced · retrying"** in GitHub mode: GitHub couldn't be reached.
  Your changes are kept and retried; click the label to retry now.
- **GitHub says "The redirect_uri is not associated with this application"**: the
  Callback URL in your GitHub App doesn't exactly match `BASE_URL/auth/callback`.
- **Stuck on "One-time setup" after creating the repo**: the app isn't installed on
  that repo. Open `github.com/apps/<your-app-name>` → Configure → add `triage-data`.
- **Server exits with "SESSION_SECRET must be set"**: generate one (see step 3).
- **Port already in use**: `PORT=8080 npm start` (and update `BASE_URL` to match).

## License

MIT. See [LICENSE](LICENSE).
