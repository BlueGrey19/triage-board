# GitHub setup

Sign in with GitHub and keep your data in your own private repo. Back to the
[README](../README.md).

- [How it works](#how-it-works)
- [1. Create the GitHub App](#1-create-the-github-app)
- [2. Create your data repo and install the app on it](#2-create-your-data-repo-and-install-the-app-on-it)
- [3. Configure and run](#3-configure-and-run)
- [All settings](#all-settings)
- [Hosting it (open it on your phone)](#hosting-it-open-it-on-your-phone)
- [Letting friends use it](#letting-friends-use-it)
- [Troubleshooting](#troubleshooting)

---

## How it works

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

- Each change is a commit (`Add item: …`, `Tick step: …`, `Link snippet: …`,
  `Move Milltrans to Go Live`), so you can view history, diff and roll back on
  github.com. Archiving writes `archive.json` first and then `board.json` (two
  commits), so an interrupted move can never lose an item. You can also hand-edit
  snippet files there; the app picks them up.

## 1. Create the GitHub App

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

## 2. Create your data repo and install the app on it

1. [Create a **private** repo](https://github.com/new?name=triage-data&visibility=private)
   named `triage-data`. Leave it empty.
2. Go to `https://github.com/apps/<your-app-name>` → **Install** → choose
   **Only select repositories** → pick `triage-data`.

If you skip this step, the app shows you these same two steps after you sign in.

## 3. Configure and run

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

## All settings

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

## Hosting it (open it on your phone)

Any Node host works (Render, Railway, Fly.io, a VPS). In GitHub mode the server
keeps nothing on disk, so free tiers that wipe the filesystem on restart are fine.

1. Deploy with start command `npm start`.
2. Set the environment variables above on the host. Set `BASE_URL` to the
   `https://…` address. Cookies are automatically marked `Secure` on https.
3. In your GitHub App settings, **add** `https://<your-host>/auth/callback` as a
   second Callback URL (keep the localhost one for local dev).
4. If it's just for you, set `ALLOWED_USERS=<your-username>`.

## Letting friends use it

Set the app to *Any account* and send them the install link
(`https://github.com/apps/<your-app-name>`). Each friend creates their own private
`triage-data` repo, installs the app on it and signs in. They only ever see their
own data, and you never see theirs.

## Troubleshooting

- **GitHub says "The redirect_uri is not associated with this application"**: the
  Callback URL in your GitHub App doesn't exactly match `BASE_URL/auth/callback`.
- **Stuck on "One-time setup" after creating the repo**: the app isn't installed on
  that repo. Open `github.com/apps/<your-app-name>` → Configure → add `triage-data`.
- **Server exits with "SESSION_SECRET must be set"**: generate one (see
  [step 3](#3-configure-and-run)).
- **Label says "Not synced · retrying"**: GitHub couldn't be reached. Your changes are
  kept and retried; click the label to retry now.
