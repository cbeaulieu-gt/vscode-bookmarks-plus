# VSCode Bookmarks Plus — Design Spec

- **Status:** Approved — captures decisions from the 2026-07-22 design brainstorming session
- **Tracking issue:** #1 ("Write and commit initial design spec")
- **Milestone:** v1.0

## 1. Overview

VSCode Bookmarks Plus is a VS Code extension that bookmarks **files and folders**, not just lines. Every existing "Bookmarks"-style extension the author has tried stops at line-level bookmarking inside a single file — this extension fills that gap by treating whole files and whole folders as first-class bookmarkable items.

Key scoping decisions:

- **Per-workspace scope.** Bookmarks are stored per workspace and work for both single-root and multi-root workspaces.
- **Language/tooling:** TypeScript, scaffolded with `yo code`, bundled with esbuild.
- **Target:** publish to the VS Code Marketplace. This requires a publisher id, a 128x128 `icon.png`, a README with a screenshot, a `CHANGELOG.md`, a `LICENSE`, and semantic versioning in `package.json` (see [§8 Packaging / publishing](#8-packaging--publishing)).

## 2. Architecture

Three core pieces make up the extension:

- **`BookmarkStore`** — wraps `context.workspaceState`. It is the single source of truth and owns all reads and writes of the bookmark tree.
- **`BookmarksTreeDataProvider`** — implements `vscode.TreeDataProvider` and `TreeDragAndDropController`. Drag-and-drop supports reordering within a parent and reassigning an item to a different collection. Collections render as parent nodes; ungrouped items render at the root.
- **Commands** — registered via `contributes.commands` / `contributes.menus`, exposed through the Explorer context menu and the command palette.

Supporting UI surface:

- A new Activity Bar container with one view, `bookmarksView`.

Data flow is one-way: a command handler calls `BookmarkStore.update()`, which fires `onDidChangeTreeData`, which causes the tree to redraw. There is no file watcher — this is deliberate and consistent with the "no auto-fix on move" decision in [§5](#5-commands).

## 3. Data model

```ts
interface BookmarkItem {
  id: string;          // uuid
  type: 'file' | 'folder';
  uri: string;          // vscode.Uri.toString(), workspace-relative when possible
  collectionId: string | null;  // null = root/ungrouped
  order: number;        // manual sort position
}

interface BookmarkCollection {
  id: string;
  name: string;
  order: number;
}

interface BookmarkData {
  version: number;      // schema version, for future migration
  items: BookmarkItem[];
  collections: BookmarkCollection[];
}
```

`BookmarkData` is stored as a single JSON blob under one `workspaceState` key, `bookmarks.data`. The `version` field exists to support future schema migrations.

Git-repo information is deliberately **not** stored on `BookmarkItem`. It is resolved at render time via the built-in `vscode.git` extension API (`repository.rootUri`), so a repo rename or move can't leave a stale badge in stored data.

## 4. UI / tree view

Each row renders as: icon (file or folder) + name + repo name as a dim description-text suffix. The repo name is resolved via the `vscode.git` API; if that extension isn't active, or the item isn't inside a repo, the badge is silently omitted — the git extension is a soft dependency, and its absence produces no error.

A broken bookmark (target path missing, checked on-demand via `fs.stat` at render time — no watcher) renders with a warning icon overlay and greyed text. There is no auto-fix; the user can only remove the entry.

The view title bar has a toggle button, `bookmarks.toggleGroupByRepo`, that flips the render mode:

- **Default:** collection → item
- **Grouped by repo:** repo-root node → collection → item

Context menus:

- **Right-click item:** Remove, Reveal in Explorer, Move to Collection
- **Right-click collection header:** Rename, Delete (deleting a collection ungroups its items rather than deleting them, and prompts a confirm dialog first)

**Empty state:** placeholder text reads "No bookmarks yet — right-click a file or folder to add one."

## 5. Commands

| Command | Trigger | Notes |
|---|---|---|
| `bookmarks.addFile` | Explorer context menu on a file + command palette | |
| `bookmarks.addFolder` | Explorer context menu on a folder + command palette | Gated by the `explorerResourceIsFolder` when-clause |
| `bookmarks.remove` | Tree item context menu | |
| `bookmarks.reveal` | Tree item click or context menu | Calls `revealInExplorer` |
| `bookmarks.newCollection` | View title button + tree context menu | Prompts for a name |
| `bookmarks.renameCollection` | Collection context menu | Prompts for a new name |
| `bookmarks.deleteCollection` | Collection context menu | Confirm dialog; ungroups items, does not delete them |
| `bookmarks.toggleGroupByRepo` | View title button | Flips render mode (see [§4](#4-ui--tree-view)) |

Click behavior: bookmarked files open in the editor; bookmarked folders reveal in the Explorer (they do not expand inline in the tree view).

Two deliberate simplicity choices:

- **No custom bookmark labels.** The tree always displays the real filename or folder name, kept simple on purpose.
- **No auto-follow on rename/move.** If a bookmarked file or folder moves, the bookmark shows as broken and the user fixes it manually. This trades away file-watcher complexity in exchange for a simpler, more predictable extension.

## 6. Error handling

Three cases are handled, and each degrades without surfacing an error dialog:

1. **Broken path** — warning icon overlay, greyed text, no auto-fix; the user removes the entry manually.
2. **Git API unavailable** — the repo-name badge is silently omitted; no error is shown, since `vscode.git` is a soft dependency.
3. **Empty state** — placeholder text guides the user to right-click a file or folder to add the first bookmark.

## 7. Testing

- Scaffold: `@vscode/test-electron` + Mocha (the standard `yo code` default).
- **Unit tests:** exercise `BookmarkStore` (add / remove / move / reorder) against a mocked `Memento`.
- **Integration tests:** verify `BookmarksTreeDataProvider` renders the expected nodes from fixture data.

## 8. Packaging / publishing

- Publisher id registered via `vsce`.
- `icon.png` at 128x128.
- README with a screenshot or gif.
- `CHANGELOG.md`.
- `LICENSE`.
- Semantic version in `package.json`.

CI (GitHub Actions running tests plus `vsce package` on tag push) is noted as a fast-follow — not a blocker for the v1.0 milestone.
