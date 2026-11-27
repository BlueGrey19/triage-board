# User guide

How to use Triage Board day to day. For setup, see the [README](../README.md); for
signing in with GitHub, see [GitHub setup](github-setup.md).

- [The board](#the-board)
- [Adding items](#adding-items)
- [Checklists](#checklists)
- [Undo](#undo)
- [Project stages](#project-stages)
- [Archive](#archive)
- [Snippets](#snippets)
- [Saving and working offline](#saving-and-working-offline)
- [Keyboard shortcuts](#keyboard-shortcuts)

---

## The board

- **Four priority columns** side by side (2×2 on smaller screens, stacked on phones).
  Change an item's priority from its `⋯` menu, or **drag the card** to another column.
- **Slim cards.** Click a card to open it and see its description, change its status,
  edit or delete it. Cards with a description show a small ≡ icon after the title.
- **Status per item:** Open, Doing, Testing, Blocked, Done. Click the status pill on a
  card to change it. Done items fold away under "✓ N done" in each column, and the item
  remembers the date it was marked done.
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
- **Themes and phones:** light, dark or auto theme (follows your system), switchable in
  the sidebar. On phones the sidebar becomes a slide-out menu.

## Adding items

- **Add item** (or press `N`) adds one item with a title, project, priority, stage,
  group and description.
- **Quick add** (or press `Q`) turns a pasted list, such as a client's email of
  amendments, into many items at once:

  ```
  - Fix login redirect
      > Users land on a blank page after signing in.
      - Check callback URL
  - Update invoice template
  ```

  | In the list | Becomes |
  |---|---|
  | A line | an item (bullets and numbering like `-`, `•`, `1.`, `a)` are stripped) |
  | An indented line | a checklist step of the item above |
  | A line starting with `>` | the description of the item above |
  | A line over 200 characters | an item with a shortened title; the full text goes in its description |

  Set the **project, priority and group** once for the batch, plus an optional
  **description for every item** (added before each item's own description). The
  preview lets you edit titles, priorities, steps and descriptions, or remove anything,
  before you add. Up to 100 items are saved as one change (one commit in GitHub mode).
  `Ctrl+Enter` adds from the text box.

## Checklists

Break an item into steps from its popup:

- Type a step and press **Enter** to add it. The box stays ready for the next one.
- Tick a step off, click its text to edit it (Enter saves, Esc cancels), or remove it
  with ×.
- Cards show progress as `☑ 2/5`, green when every step is done. Search finds step text
  too. The item's status stays manual.

## Undo

After changing an item's status, priority, project or stage, saving an edit, or
archiving one item, a message at the bottom offers **Undo** for about 6 seconds.
Hovering over it keeps it open. `Ctrl+Z` does the same while the message is showing
(but not while you're typing in a field). Deletes ask first instead of offering Undo.

## Project stages

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

## Archive

- **Archive done** (next to the search box) archives the done items the current filters
  show, e.g. everything done in Project: Milltrans + Group: Development.
- **Archive one item** from its `⋯` menu or popup, with Undo.
- **Close project** (from the stage track on Hypercare, or **Manage** in the sidebar)
  moves all of a project's items to the archive and takes the project off the board.
- The **Archive** page lists archived items with search and project, group and stage
  filters. **Restore** puts an item back exactly as it was; **Reopen project** brings
  back a closed project with all its items.

## Snippets

- **Two-pane library:** a searchable list on the left; the selected snippet on the right
  with line numbers, syntax highlighting (including Deluge) and one-click copy.
- Each snippet has a title, language, **Used in** (e.g. Workflow function, Webhook,
  Client script), tags, **projects**, description and code.
- **Filters** sit on one row: Used in and Project dropdowns, the most-used tags, and
  **More tags** to search every tag. Type `#tag` in the search box to filter by a tag
  (e.g. `#books invoice`). Active filters show as removable chips.

### Linking snippets and the board

- **From an item:** **Link snippet** in its popup opens a searchable picker. Linked
  snippets show as chips; click one to open it, or × to unlink. Cards show a link count.
- **From a snippet:** its **Used for** list shows the items it's linked to (archived ones
  too, greyed out), and **Link to item** links one from this side.
- **Projects:** a snippet can also belong to projects directly, e.g. a client's API
  helper. Filter the board to a project and its **Snippets** button lists everything
  linked to it, directly or through its items.
- Deleting a snippet warns if items link to it; those items then show a "Deleted
  snippet" chip you can remove.

## Saving and working offline

- **Every change shows immediately** and is saved in the background. The label next to
  the page title shows the state:

  | Label | Meaning |
  |---|---|
  | *Synced to GitHub* / *Saved locally* | everything is saved |
  | *Saving…* | a change is being saved |
  | *Not synced · N changes · retrying* | saving failed; your changes are kept and retried |
  | *Offline · N changes waiting* | your device has no connection |

- Unsaved changes are kept in the browser (they survive a refresh) and retried until
  they save, one GitHub commit each. Click the label to retry straight away.
- If the app is opened while GitHub can't be reached, it shows your last saved copy of
  the board, snippets and archive.

## Keyboard shortcuts

| Key | Does |
|---|---|
| `/` | Jump to search (board or snippets) |
| `N` | Add a new board item |
| `Q` | Quick add: paste a list of items |
| `Ctrl+Z` | Undo the last change while its message is showing (not while typing) |
| `Ctrl+Enter` | Add the items in Quick add |
| `Esc` | Close the open menu or window, or clear the search box |
| `↑` `↓` `Enter` | Move through and pick from menus, dropdowns and suggestions |
