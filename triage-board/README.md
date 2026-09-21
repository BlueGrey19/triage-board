# Triage Board

A single, no-nonsense **to-do triage board** you run on your own machine. Items
are sorted into four priority bands — **Critical / High / Medium / Low** — and
within each band they're grouped by project, so when you're juggling several
clients or side-projects you can still see each one's pile at a glance.

It's a neon-on-black web app, but there's no cloud and no account: a small local
server keeps everything in one plain `data/board.json` file on your computer.
Close it, reopen it, restart your machine — your board is exactly where you left
it.

![priority bands: Critical, High, Medium, Low — each split into per-project groups]

## What it does

- **Add, edit and delete items** right on the board — no editing files by hand.
- **Four priority bands.** Change an item's priority from a dropdown on the card,
  or just **drag the card** into another band.
- **Per-project grouping inside every band**, so Client A's critical work is
  visually separated from Client B's.
- **Manage your own projects.** Add the things *you're* working on (Milltrans,
  Cradle Tech, RMI, whatever) and they instantly become options in the project
  filter and in the "new item" dropdown.
- **Two filter rows** — one for project, one for status (All / Not done / Done /
  Blocked).
- **Four statuses per item**: Open, Doing, Blocked, Done.
- **Everything saves to disk automatically.** Every change is written to
  `data/board.json` by the server the moment you make it.

---

## Requirements

- [Node.js](https://nodejs.org) version 18 or newer. Check with:
  ```bash
  node --version
  ```
  If that prints something like `v18.x` or higher, you're set. If the command
  isn't found, install Node from the link above first.

---

## Run it locally (terminal)

From inside the project folder:

```bash
npm install     # one time — downloads the one dependency (Express)
npm start       # starts the board
```

You'll see:

```
  Triage Board is running.
  Open  ->  http://localhost:4317
```

Open that link in your browser. **Leave the terminal window open** while you use
the board — that's the little server doing the saving. Press `Ctrl + C` in the
terminal to stop it.

> Want a different port? `PORT=8080 npm start`

## Run it from VS Code

1. Open the project folder in VS Code (`File > Open Folder…`).
2. Open a terminal (`Terminal > New Terminal`) and run `npm install` once.
3. Press **F5** (or `Run > Start Debugging`) — the included launch config boots
   the server. Then open http://localhost:4317.

Alternatively just run `npm start` in the VS Code terminal.

---

## Where your projects live

You don't need to touch any files to manage projects — click **⚙ Projects** in
the top bar to add or remove them. But if you'd rather set them up before first
launch, you can:

- Edit **`data/seed.json`** *before your first run* to change the starter
  projects. This file is only used to create your board the very first time.
- Once you've run the app, your live data is in **`data/board.json`**. You can
  hand-edit that too if you like — it's just JSON — but it's easier to use the
  buttons.

Removing a project from the list does **not** delete its items; they stay on the
board with their label, you just lose the filter chip for them.

---

## Your data & privacy

- Everything is stored in `data/board.json` on your own machine. Nothing is sent
  anywhere.
- That file is **git-ignored**, so if you push this repo to GitHub your personal
  board is not uploaded — only the app itself is shared. Each person who clones
  the repo gets their own fresh, empty board.
- Want a backup? Copy `data/board.json` somewhere safe. Want to move your board
  to another computer? Copy that one file across.

---

## Put it on GitHub (so friends can use it)

From inside the project folder:

```bash
git init
git add .
git commit -m "Triage Board"
```

Then create an empty repository on GitHub (no README, since you already have
one), and follow the two lines GitHub shows you — they'll look like:

```bash
git remote add origin https://github.com/YOUR-USERNAME/triage-board.git
git branch -M main
git push -u origin main
```

Your friends then just:

```bash
git clone https://github.com/YOUR-USERNAME/triage-board.git
cd triage-board
npm install
npm start
```

…and they get their own private board with the example projects, ready to make
their own.

---

## Project structure

```
triage-board/
├── server.js            the local server + save-to-disk API
├── package.json         dependency + start script
├── public/              the board UI (served to your browser)
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── data/
│   ├── seed.json        starter projects (used only on first run)
│   └── board.json       your live board (created on first run, git-ignored)
├── .vscode/launch.json  press F5 in VS Code to run
├── .gitignore
├── LICENSE
└── README.md
```

## Troubleshooting

- **"Could not reach the server" in the browser** — the terminal running
  `npm start` was closed or crashed. Start it again.
- **Port already in use** — something else is on 4317. Run on another port:
  `PORT=8080 npm start`.
- **`npm: command not found`** — Node isn't installed or isn't on your PATH.
  Install it from [nodejs.org](https://nodejs.org).

## License

MIT — do whatever you like with it. See [LICENSE](LICENSE).
