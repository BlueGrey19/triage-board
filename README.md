# Triage Board

A **to-do triage board** with a built-in **code snippet library**, in light and dark mode.

- **Board:** items sit in four priority columns (**Critical / High / Medium / Low**),
  each tagged with its project and groups. Filter by project, group, status or search
  to see one client's pile at a glance, even when you're juggling several.
- **Snippets:** your reusable code (Deluge, JS, SQL, and others) in a two-pane library
  with search, tags, syntax highlighting and one-click copy, so you stop rewriting the
  same thing for every client.

It runs in one of two modes:

| | **Local mode** (default) | **GitHub mode** |
|---|---|---|
| Login | none | "Sign in with GitHub" |
| Where data lives | `data/` folder on your machine | a private repo in *your* GitHub account |
| History / undo | no | every change is a git commit |
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
  card to change it. Done items fold away under "✓ N done" in each column.
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

### Snippets

- **Two-pane library:** a searchable list on the left; the selected snippet on the right
  with line numbers, syntax highlighting (including Deluge) and one-click copy.
- Each snippet has a title, language, **Used in** (e.g. Workflow function, Webhook,
  Client script), tags, description and code. Filter by Used in or by tag.

### General

- **Light, dark or auto theme** (follows your system), switchable in the sidebar.
- **Works on phones:** the sidebar becomes a slide-out menu.
- **Saves automatically.** Every change is written the moment you make it.

### Keyboard shortcuts

| Key | Does |
|---|---|
| `/` | Jump to search (board or snippets) |
| `N` | Add a new board item |
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

Open http://localhost:4317. Your board saves to `data/board.json` and snippets to
`data/snippets/*.md`. Both are git-ignored, so pushing this repo never uploads your data.

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
  ├── board.json              projects, project colours + triage items
  └── snippets/
      ├── books-create-invoice-a1b2.md
      └── ...                 one readable markdown file per snippet
  ```

  A snippet file starts with a short header (title, language, optional `type` for
  "Used in", tags, dates), followed by the description and the code block.

  Each change is a commit (`Add item: …`, `Update snippet: …`), so you can view
  history, diff and roll back on github.com. You can also hand-edit snippet files
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
│   ├── model.js           item / snippet validation + snippet file format
│   ├── store-local.js     local-mode storage (data/ folder)
│   ├── store-github.js    GitHub-mode storage (Contents + GraphQL APIs)
│   ├── github.js          GitHub login + API client (built-in fetch, no SDK)
│   ├── session.js         encrypted cookie sessions
│   └── env.js             tiny .env loader
├── public/                the UI (index.html, styles.css, app.js)
├── data/
│   ├── seed.json          starter projects for a brand-new board
│   ├── board.json         local-mode board (git-ignored)
│   └── snippets/          local-mode snippets (git-ignored)
├── .env.example           copy to .env for GitHub mode
├── .vscode/launch.json    press F5 to run
├── LICENSE
└── README.md
```

## Troubleshooting

- **"Could not reach the server"**: the `npm start` terminal was closed or crashed.
  Start it again.
- **GitHub says "The redirect_uri is not associated with this application"**: the
  Callback URL in your GitHub App doesn't exactly match `BASE_URL/auth/callback`.
- **Stuck on "One-time setup" after creating the repo**: the app isn't installed on
  that repo. Open `github.com/apps/<your-app-name>` → Configure → add `triage-data`.
- **Server exits with "SESSION_SECRET must be set"**: generate one (see step 3).
- **Port already in use**: `PORT=8080 npm start` (and update `BASE_URL` to match).

## License

MIT. See [LICENSE](LICENSE).
