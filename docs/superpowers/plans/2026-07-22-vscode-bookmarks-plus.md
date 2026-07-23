# VSCode Bookmarks Plus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the VS Code extension "Bookmarks Plus" from an empty repo to a publishable v1.0, exactly per `docs/superpowers/specs/2026-07-22-vscode-bookmarks-plus-design.md` (the "spec" — all section references `§N` below point there).

**Architecture:** Three layers wired one-way: `BookmarkStore` (owns `workspaceState`, fires one `onBookmarksChanged` event per mutation) → `BookmarksTreeDataProvider` (renders from the store, re-fires `onDidChangeTreeData`, also implements `TreeDragAndDropController`) → command handlers (thin wrappers that call named `BookmarkStore` methods, including drag-and-drop). An in-memory `FsGitCache` sits beside the tree provider to avoid re-running `fs.stat`/git lookups on every redraw.

**Tech Stack:** TypeScript, hand-authored scaffold matching the `yo code` TypeScript+esbuild template (no interactive generator run, since this session is non-interactive — the resulting files are equivalent), esbuild bundling, `@vscode/test-electron` + Mocha (`tdd` UI) for all tests, run through a single `npm test` in the Extension Development Host.

## Global Constraints

Copied verbatim (or near-verbatim) from the spec — every task below implicitly inherits these:

- Bookmarks are stored **per workspace**, for both single-root and multi-root workspaces (§1).
- **`BookmarkStore` is the only thing that touches `workspaceState`** — no other component reads or writes it directly (§2).
- **Exactly one domain event**: `BookmarkStore.onBookmarksChanged: vscode.Event<void>` fires once per mutating method call; `getAll()` never fires it (§2).
- `BookmarksTreeDataProvider` subscribes to `onBookmarksChanged` and re-fires its own `onDidChangeTreeData` — one hop, no independently-firing emitters (§2).
- **All mutations, without exception, go through named `BookmarkStore` methods** — `TreeDragAndDropController.handleDrop()` calls `BookmarkStore.moveItem()` directly, the same path every command handler uses (§2).
- **`BookmarkItem.uri` is always the full absolute `vscode.Uri.toString()`** — never workspace-relative, no relative-path resolution anywhere (§3).
- **Ordering is zero-based and contiguous per parent.** Every insert/move/delete renumbers all siblings in that parent in-memory, then performs exactly one `workspaceState.update()` call — never N per-sibling writes (§3).
- **`deleteCollection` is a single atomic write**: sets `collectionId: null` on every affected item, removes the collection, one `workspaceState.update()` call, one `onBookmarksChanged` firing. Items are never deleted (§3).
- **Malformed stored data never crashes activation.** Missing/`null`/malformed `bookmarks.data` → fresh `{ version: 1, items: [], collections: [] }`, a warning logged to the output channel, activation proceeds (§3, §6).
- **No cross-window conflict detection** — last-write-wins on `workspaceState.update()`, explicitly out of scope for v1 (§3).
- **Git-repo info is never stored on `BookmarkItem`** — resolved at render time via the `vscode.git` extension API, treated as a soft dependency (§3, §4, §6).
- **In-memory `Map<uri, { stat, repoName }>` cache**, invalidated only on `onBookmarksChanged` and the `bookmarks.refresh` command — no TTL, no file watcher (§2).
- **No auto-fix on move/rename** — a moved/renamed target just shows as broken; the user removes it manually (§5).
- **`bookmarks.addFile` / `bookmarks.addFolder` are Explorer-context-menu only** — deliberately not on the command palette (§5).
- **Folder bookmarks are always leaf nodes** (`collapsibleState: None`) — folder click reveals in Explorer, never expands inline (§5).
- **No custom bookmark labels** — always the real filename/folder name (§5).
- **Drag-and-drop is disabled in group-by-repo mode** — only available in default (collection → item) mode (§4).
- **CI is explicitly out of scope for this plan** (tracked separately in issue #3) — no task below sets up GitHub Actions.

### Note on spec ambiguities resolved during planning

The spec is internally consistent almost everywhere, but three points needed a concrete resolution to write real code. Each is called out again in its owning task; flagging all three here for a reviewer's convenience:

1. **View-title button count.** §4 says "the view title bar has two buttons" (`toggleGroupByRepo`, `refresh`), but the §5 commands table lists `bookmarks.newCollection`'s trigger as "View title button + tree context menu + command palette." Resolved as **three** title-bar buttons (Task 1's `package.json`) — the §5 table is the more granular, per-command source of truth.
2. **Git-ready re-render mechanism.** §4 says the extension "fires `onBookmarksChanged` once" when the git API first becomes ready. But §2 enumerates `BookmarkStore`'s entire public surface (`addItem/removeItem/moveItem/addCollection/renameCollection/deleteCollection/getAll`) with no force-fire method, and firing the store's event without a real mutation would misrepresent what the event means. Resolved by calling `BookmarksTreeDataProvider.refresh()` instead (Task 6/13) — it produces the identical externally observable effect (one cache invalidation, one redraw) via the mechanism §4 already specifies for the manual `bookmarks.refresh` command.
3. **`bookmarks.reveal` vs. click-to-open.** The §5 table says `bookmarks.reveal` "Calls `revealInExplorer`" and lists its trigger as "Tree item click or context menu." The prose right below it says file bookmarks *open in the editor* on click, only folder bookmarks *reveal* on click. Resolved (Task 10): a **file** bookmark's `TreeItem.command` opens it directly (`vscode.open`), bypassing `bookmarks.reveal`; a **folder** bookmark's click goes through `bookmarks.reveal` (its only possible click target, per §5's "Folder click behavior" note); the **context-menu** "Reveal in Explorer" action (available on both types per §4) always goes through `bookmarks.reveal` → `revealInExplorer`. This satisfies every sentence in §4/§5 without contradiction.

---

## File Structure

```
package.json                          Extension manifest: metadata, contributes, scripts, deps
tsconfig.json                         Compiles src/**/*.ts (incl. tests) to out/ for the Mocha runner
esbuild.js                            Bundles src/extension.ts -> dist/extension.js
.vscode/launch.json                   F5 launch config (Extension Development Host + test debug)
.vscode/tasks.json                    Background esbuild watch task used by launch.json
CHANGELOG.md                          Keep-a-changelog-style release notes
LICENSE                               MIT
README.md                             Updated with dev/build/test/usage instructions (existing file)
src/
  extension.ts                       Activation entrypoint — wires store, cache, provider, commands
  types.ts                           BookmarkItem / BookmarkCollection / BookmarkData + shape validation
  bookmarkStore.ts                   BookmarkStore class
  fsGitCache.ts                      FsGitCache — the in-memory Map<uri, {exists, repoName}>
  gitInfo.ts                         vscode.git soft-dependency handling + repo-root resolution
  bookmarksTreeDataProvider.ts       BookmarksTreeDataProvider (TreeDataProvider + TreeDragAndDropController)
  commands.ts                        All command handler factories + registration functions
  test/
    runTest.ts                       @vscode/test-electron entrypoint (launches the dev host)
    suite/
      index.ts                       Mocha (tdd) suite loader
      fixtures.ts                    FakeMemento, FakeOutput, small data builders
      bookmarkStore.test.ts          Task 2-4 unit tests
      fsGitCache.test.ts             Task 5 unit tests
      gitInfo.test.ts                Task 6 unit tests
      bookmarksTreeDataProvider.test.ts   Task 7-9 integration tests
      commands.test.ts               Task 10-12 unit tests
      extension.test.ts              Task 1 smoke test + Task 13 activation test
```

Each file has one responsibility; `commands.ts` is the one exception allowed to grow (it groups small, closely-related handler factories that all depend on the same `BookmarkStore`/`BookmarksTreeDataProvider` pair — splitting it further would just scatter one-line functions across files for no benefit, which YAGNI argues against).

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `esbuild.js`
- Create: `.vscode/launch.json`
- Create: `.vscode/tasks.json`
- Create: `src/extension.ts`
- Create: `src/test/runTest.ts`
- Create: `src/test/suite/index.ts`
- Test: `src/test/suite/extension.test.ts`
- Modify: `README.md`

**Interfaces:**
- Produces: `activate(context: vscode.ExtensionContext): void` and `deactivate(): void`, exported from `src/extension.ts` — every later task adds wiring inside `activate`.
- Produces: `npm test` as the single command that runs the whole suite (unit + integration) inside the Extension Development Host.

**Note on TDD in this task:** there is no pre-existing behavior to redden — the deliverable itself is the test harness. This task's verification is "write the smoke test, run it, confirm it passes," not a red/green cycle. Proper TDD (red, then green) starts in Task 2.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "vscode-bookmarks-plus",
  "displayName": "Bookmarks Plus",
  "description": "Bookmark files and folders (not just lines) in a workspace, with collections and git-repo awareness.",
  "version": "0.1.0",
  "publisher": "cbeaulieu-gt",
  "license": "MIT",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other"],
  "icon": "images/icon.png",
  "activationEvents": [],
  "main": "./dist/extension.js",
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        { "id": "bookmarksActivityBar", "title": "Bookmarks Plus", "icon": "$(bookmark)" }
      ]
    },
    "views": {
      "bookmarksActivityBar": [
        { "id": "bookmarksView", "name": "Bookmarks", "icon": "$(bookmark)" }
      ]
    },
    "viewsWelcome": [
      {
        "view": "bookmarksView",
        "contents": "No bookmarks yet — right-click a file or folder to add one."
      }
    ],
    "commands": [
      { "command": "bookmarks.addFile", "title": "Add Bookmark", "category": "Bookmarks Plus" },
      { "command": "bookmarks.addFolder", "title": "Add Bookmark", "category": "Bookmarks Plus" },
      { "command": "bookmarks.remove", "title": "Remove Bookmark", "category": "Bookmarks Plus" },
      { "command": "bookmarks.reveal", "title": "Reveal in Explorer", "category": "Bookmarks Plus" },
      { "command": "bookmarks.newCollection", "title": "New Collection", "category": "Bookmarks Plus", "icon": "$(new-folder)" },
      { "command": "bookmarks.renameCollection", "title": "Rename Collection", "category": "Bookmarks Plus" },
      { "command": "bookmarks.deleteCollection", "title": "Delete Collection", "category": "Bookmarks Plus" },
      { "command": "bookmarks.moveToCollection", "title": "Move to Collection", "category": "Bookmarks Plus" },
      { "command": "bookmarks.toggleGroupByRepo", "title": "Toggle Group by Repo", "category": "Bookmarks Plus", "icon": "$(repo)" },
      { "command": "bookmarks.refresh", "title": "Refresh", "category": "Bookmarks Plus", "icon": "$(refresh)" }
    ],
    "menus": {
      "explorer/context": [
        { "command": "bookmarks.addFile", "when": "!explorerResourceIsFolder", "group": "bookmarksPlus" },
        { "command": "bookmarks.addFolder", "when": "explorerResourceIsFolder", "group": "bookmarksPlus" }
      ],
      "view/title": [
        { "command": "bookmarks.newCollection", "when": "view == bookmarksView", "group": "navigation@1" },
        { "command": "bookmarks.toggleGroupByRepo", "when": "view == bookmarksView", "group": "navigation@2" },
        { "command": "bookmarks.refresh", "when": "view == bookmarksView", "group": "navigation@3" }
      ],
      "view/item/context": [
        { "command": "bookmarks.remove", "when": "view == bookmarksView && viewItem == bookmarkItem", "group": "inline@1" },
        { "command": "bookmarks.reveal", "when": "view == bookmarksView && viewItem == bookmarkItem", "group": "inline@2" },
        { "command": "bookmarks.moveToCollection", "when": "view == bookmarksView && viewItem == bookmarkItem", "group": "inline@3" },
        { "command": "bookmarks.renameCollection", "when": "view == bookmarksView && viewItem == bookmarkCollection", "group": "inline@1" },
        { "command": "bookmarks.deleteCollection", "when": "view == bookmarksView && viewItem == bookmarkCollection", "group": "inline@2" }
      ],
      "commandPalette": [
        { "command": "bookmarks.addFile", "when": "false" },
        { "command": "bookmarks.addFolder", "when": "false" }
      ]
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run package",
    "compile": "node esbuild.js",
    "watch": "node esbuild.js --watch",
    "package": "node esbuild.js --production",
    "compile-tests": "tsc -p . --outDir out",
    "watch-tests": "tsc -p . -w --outDir out",
    "pretest": "npm run compile-tests && npm run compile",
    "test": "node ./out/test/runTest.js",
    "lint": "eslint src --ext ts"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@types/node": "^20.11.0",
    "@types/mocha": "^10.0.6",
    "@types/glob": "^8.1.0",
    "typescript": "^5.4.0",
    "esbuild": "^0.20.0",
    "mocha": "^10.3.0",
    "glob": "^10.3.10",
    "@vscode/test-electron": "^2.3.9",
    "eslint": "^8.57.0",
    "@typescript-eslint/eslint-plugin": "^7.1.0",
    "@typescript-eslint/parser": "^7.1.0"
  }
}
```

`bookmarks.addFile`/`bookmarks.addFolder` get `"when": "false"` in `commandPalette` — this is the concrete mechanism for the §5 "command-palette scope cut" constraint. `viewItem == bookmarkItem` / `bookmarkCollection` are `contextValue`s the tree provider sets in Task 7.

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "out",
    "rootDir": "src",
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write `esbuild.js`**

```js
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'info'
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Write `src/extension.ts` (minimal stub)**

```ts
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  // Store, cache, tree provider, and command wiring are added in later tasks.
}

export function deactivate(): void {}
```

- [ ] **Step 5: Write the test harness — `src/test/runTest.ts`**

```ts
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');
    await runTests({ extensionDevelopmentPath, extensionTestsPath });
  } catch (err) {
    console.error('Failed to run tests', err);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 6: Write `src/test/suite/index.ts`**

```ts
import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 20000 });
  const testsRoot = path.resolve(__dirname, '.');

  const files = await glob('**/*.test.js', { cwd: testsRoot });
  files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

  return new Promise((resolve, reject) => {
    try {
      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
```

- [ ] **Step 7: Write the failing smoke test — `src/test/suite/extension.test.ts`**

```ts
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension activation', () => {
  test('extension is present and activates', async () => {
    const ext = vscode.extensions.getExtension('cbeaulieu-gt.vscode-bookmarks-plus');
    assert.ok(ext, 'extension not found — check "publisher"/"name" in package.json');
    await ext!.activate();
    assert.strictEqual(ext!.isActive, true);
  });
});
```

- [ ] **Step 8: Write `.vscode/launch.json`**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "preLaunchTask": "npm: watch"
    },
    {
      "name": "Extension Tests",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}",
        "--extensionTestsPath=${workspaceFolder}/out/test/suite/index"
      ],
      "outFiles": ["${workspaceFolder}/out/test/**/*.js"],
      "preLaunchTask": "npm: pretest"
    }
  ]
}
```

- [ ] **Step 9: Write `.vscode/tasks.json`**

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "npm",
      "script": "watch",
      "problemMatcher": "$tsc-watch",
      "isBackground": true,
      "presentation": { "reveal": "never" },
      "group": { "kind": "build", "isDefault": true }
    }
  ]
}
```

- [ ] **Step 10: Install dependencies**

Run: `npm install`
Expected: `node_modules/` populated, `package-lock.json` created, no errors.

- [ ] **Step 11: Run the test suite and confirm it passes**

Run: `npm test`
Expected: downloads a VS Code test instance on first run, then `1 passing` (the smoke test from Step 7).

- [ ] **Step 12: Update `README.md` with development instructions**

Add a `## Development` section under the existing "Status" line:

```markdown

## Development

- `npm install` — install dependencies
- `npm run compile` — bundle `src/extension.ts` to `dist/extension.js` via esbuild
- `npm test` — compile tests, then run the full suite in a headless VS Code Extension Development Host
- Press F5 in VS Code (or use the "Run Extension" launch config) to open an Extension Development Host with the extension loaded
```

- [ ] **Step 13: Commit**

```bash
git add package.json tsconfig.json esbuild.js .vscode/launch.json .vscode/tasks.json src/extension.ts src/test README.md
git commit -m "feat: scaffold vscode-bookmarks-plus extension project"
```

---

### Task 2: BookmarkStore — load/save, addItem, removeItem

**Files:**
- Create: `src/types.ts`
- Create: `src/bookmarkStore.ts`
- Create: `src/test/suite/fixtures.ts`
- Test: `src/test/suite/bookmarkStore.test.ts`

**Interfaces:**
- Consumes: nothing outside this task.
- Produces (used by every later task): `BookmarkItem`, `BookmarkCollection`, `BookmarkData` from `types.ts`; `class BookmarkStore` with constructor `(state: vscode.Memento, output?: OutputSink)`, method `getAll(): BookmarkData`, method `addItem(input: { type: 'file'|'folder'; uri: string; collectionId?: string | null }): Promise<BookmarkItem>`, method `removeItem(id: string): Promise<void>`, and `readonly onBookmarksChanged: vscode.Event<void>`.
- Produces (test fixtures used by every later test file): `FakeMemento` (implements `vscode.Memento`, tracks `updateCallCount`), `FakeOutput` (implements `OutputSink`, records lines).

- [ ] **Step 1: Write `src/types.ts`**

```ts
export interface BookmarkItem {
  id: string;                    // uuid
  type: 'file' | 'folder';
  uri: string;                   // vscode.Uri.toString() — always absolute, never workspace-relative
  collectionId: string | null;   // null = root/ungrouped
  order: number;                 // zero-based, unique within its parent
}

export interface BookmarkCollection {
  id: string;
  name: string;
  order: number;                 // zero-based, unique among collections
}

export interface BookmarkData {
  version: number;               // schema version, for future migration
  items: BookmarkItem[];
  collections: BookmarkCollection[];
}

export const CURRENT_SCHEMA_VERSION = 1;

export function emptyBookmarkData(): BookmarkData {
  return { version: CURRENT_SCHEMA_VERSION, items: [], collections: [] };
}

export function isValidBookmarkData(value: unknown): value is BookmarkData {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const v = value as Record<string, unknown>;
  return typeof v.version === 'number' && Array.isArray(v.items) && Array.isArray(v.collections);
}
```

- [ ] **Step 2: Write `src/test/suite/fixtures.ts`**

```ts
import * as vscode from 'vscode';

export class FakeMemento implements vscode.Memento {
  private store = new Map<string, unknown>();
  updateCallCount = 0;

  constructor(initial?: Record<string, unknown>) {
    if (initial) {
      for (const [key, value] of Object.entries(initial)) {
        this.store.set(key, value);
      }
    }
  }

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.store.has(key) ? (this.store.get(key) as T) : defaultValue;
  }

  update(key: string, value: unknown): Thenable<void> {
    this.store.set(key, value);
    this.updateCallCount++;
    return Promise.resolve();
  }

  keys(): readonly string[] {
    return [...this.store.keys()];
  }

  setKeysForSync(): void {
    // Not used by BookmarkStore; present only to satisfy vscode.Memento's shape if extended later.
  }
}

export class FakeOutput {
  lines: string[] = [];
  appendLine(value: string): void {
    this.lines.push(value);
  }
}
```

- [ ] **Step 3: Write the failing tests — `src/test/suite/bookmarkStore.test.ts`**

```ts
import * as assert from 'assert';
import { BookmarkStore } from '../../bookmarkStore';
import { FakeMemento, FakeOutput } from './fixtures';

suite('BookmarkStore - load and core CRUD', () => {
  test('initializes empty data when storage is empty', () => {
    const store = new BookmarkStore(new FakeMemento());
    assert.deepStrictEqual(store.getAll(), { version: 1, items: [], collections: [] });
  });

  test('recovers from malformed stored data without throwing, and logs a warning', () => {
    const memento = new FakeMemento({ 'bookmarks.data': { totally: 'wrong shape' } });
    const output = new FakeOutput();
    const store = new BookmarkStore(memento, output);

    assert.deepStrictEqual(store.getAll(), { version: 1, items: [], collections: [] });
    assert.strictEqual(output.lines.length, 1);
  });

  test('recovers when the stored value is null', () => {
    const memento = new FakeMemento({ 'bookmarks.data': null });
    const store = new BookmarkStore(memento);
    assert.deepStrictEqual(store.getAll(), { version: 1, items: [], collections: [] });
  });

  test('addItem assigns sequential order within the root parent', async () => {
    const store = new BookmarkStore(new FakeMemento());
    const first = await store.addItem({ type: 'file', uri: 'file:///a.txt' });
    const second = await store.addItem({ type: 'file', uri: 'file:///b.txt' });
    assert.strictEqual(first.order, 0);
    assert.strictEqual(second.order, 1);
  });

  test('addItem assigns sequential order within a collection, independent of root order', async () => {
    const memento = new FakeMemento();
    const store = new BookmarkStore(memento);
    await store.addItem({ type: 'file', uri: 'file:///root.txt' });
    const collectionId = 'col-1';
    const first = await store.addItem({ type: 'file', uri: 'file:///a.txt', collectionId });
    const second = await store.addItem({ type: 'file', uri: 'file:///b.txt', collectionId });
    assert.strictEqual(first.order, 0);
    assert.strictEqual(second.order, 1);
  });

  test('multi-root URI resolution: the stored uri is the absolute URI verbatim, regardless of workspace root', async () => {
    const store = new BookmarkStore(new FakeMemento());
    const absoluteUri = 'file:///workspace-root-two/nested/file.ts';
    const item = await store.addItem({ type: 'file', uri: absoluteUri });

    const retrieved = store.getAll().items.find((i) => i.id === item.id)!;
    assert.strictEqual(retrieved.uri, absoluteUri, 'no relative-path resolution should ever be applied');
  });

  test('removeItem renumbers remaining siblings to stay contiguous', async () => {
    const store = new BookmarkStore(new FakeMemento());
    const a = await store.addItem({ type: 'file', uri: 'file:///a.txt' });
    const b = await store.addItem({ type: 'file', uri: 'file:///b.txt' });
    const c = await store.addItem({ type: 'file', uri: 'file:///c.txt' });

    await store.removeItem(a.id);

    const remaining = store.getAll().items.sort((x, y) => x.order - y.order);
    assert.strictEqual(remaining.length, 2);
    assert.deepStrictEqual(remaining.map((i) => i.id), [b.id, c.id]);
    assert.deepStrictEqual(remaining.map((i) => i.order), [0, 1]);
  });

  test('removeItem on an unknown id is a no-op', async () => {
    const store = new BookmarkStore(new FakeMemento());
    await store.addItem({ type: 'file', uri: 'file:///a.txt' });
    await store.removeItem('does-not-exist');
    assert.strictEqual(store.getAll().items.length, 1);
  });

  test('getAll does not fire onBookmarksChanged', () => {
    const store = new BookmarkStore(new FakeMemento());
    let fired = false;
    store.onBookmarksChanged(() => { fired = true; });
    store.getAll();
    assert.strictEqual(fired, false);
  });

  test('addItem fires onBookmarksChanged exactly once', async () => {
    const store = new BookmarkStore(new FakeMemento());
    let fireCount = 0;
    store.onBookmarksChanged(() => { fireCount++; });
    await store.addItem({ type: 'file', uri: 'file:///a.txt' });
    assert.strictEqual(fireCount, 1);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../../bookmarkStore'` (the module does not exist yet).

- [ ] **Step 5: Write the minimal implementation — `src/bookmarkStore.ts`**

```ts
import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import {
  BookmarkData,
  BookmarkItem,
  BookmarkCollection,
  emptyBookmarkData,
  isValidBookmarkData
} from './types';

const STORAGE_KEY = 'bookmarks.data';

export interface OutputSink {
  appendLine(value: string): void;
}

export interface AddItemInput {
  type: 'file' | 'folder';
  uri: string;
  collectionId?: string | null;
}

const noopOutput: OutputSink = { appendLine: () => {} };

export class BookmarkStore {
  private data: BookmarkData;
  private readonly _onBookmarksChanged = new vscode.EventEmitter<void>();
  readonly onBookmarksChanged: vscode.Event<void> = this._onBookmarksChanged.event;

  constructor(
    private readonly state: vscode.Memento,
    private readonly output: OutputSink = noopOutput
  ) {
    this.data = this.load();
  }

  private load(): BookmarkData {
    const stored = this.state.get<unknown>(STORAGE_KEY);
    if (stored === undefined || stored === null || !isValidBookmarkData(stored)) {
      this.output.appendLine(
        'BookmarkStore: stored bookmarks.data is missing or malformed — starting from an empty state.'
      );
      return emptyBookmarkData();
    }
    return stored;
  }

  private async persist(): Promise<void> {
    await this.state.update(STORAGE_KEY, this.data);
    this._onBookmarksChanged.fire();
  }

  private renumber(list: { order: number }[]): void {
    list.sort((a, b) => a.order - b.order);
    list.forEach((entry, index) => {
      entry.order = index;
    });
  }

  getAll(): BookmarkData {
    return this.data;
  }

  async addItem(input: AddItemInput): Promise<BookmarkItem> {
    const collectionId = input.collectionId ?? null;
    const siblingCount = this.data.items.filter((i) => i.collectionId === collectionId).length;
    const item: BookmarkItem = {
      id: randomUUID(),
      type: input.type,
      uri: input.uri,
      collectionId,
      order: siblingCount
    };
    this.data.items.push(item);
    await this.persist();
    return item;
  }

  async removeItem(id: string): Promise<void> {
    const target = this.data.items.find((i) => i.id === id);
    if (!target) {
      return;
    }
    this.data.items = this.data.items.filter((i) => i.id !== id);
    const siblings = this.data.items.filter((i) => i.collectionId === target.collectionId);
    this.renumber(siblings);
    await this.persist();
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: `10 passing` (all of Step 3's tests, plus the Task 1 smoke test).

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/bookmarkStore.ts src/test/suite/fixtures.ts src/test/suite/bookmarkStore.test.ts
git commit -m "feat: add BookmarkStore load/save, addItem, removeItem with malformed-data recovery"
```

---

### Task 3: BookmarkStore — moveItem (reorder, cross-collection move, renumbering)

**Files:**
- Modify: `src/bookmarkStore.ts`
- Test: `src/test/suite/bookmarkStore.test.ts`

**Interfaces:**
- Consumes: `BookmarkStore` from Task 2 (extends it in place — same class, same file).
- Produces (used by Task 9's `handleDrop` and Task 11's `moveToCollection` handler): `moveItem(id: string, newCollectionId: string | null, newIndex: number): Promise<void>`.
- Also adds a minimal `addCollection(name: string): Promise<BookmarkCollection>` (needed by this task's own cross-collection test) — Task 4 consumes and extends it with `renameCollection`/`deleteCollection` on the same class.

- [ ] **Step 1: Write the failing tests (append to `bookmarkStore.test.ts`)**

```ts
suite('BookmarkStore - moveItem', () => {
  test('reordering within the same parent renumbers all siblings to 0..n-1', async () => {
    const store = new BookmarkStore(new FakeMemento());
    const a = await store.addItem({ type: 'file', uri: 'file:///a.txt' });
    const b = await store.addItem({ type: 'file', uri: 'file:///b.txt' });
    const c = await store.addItem({ type: 'file', uri: 'file:///c.txt' });

    // Move c (order 2) to index 0.
    await store.moveItem(c.id, null, 0);

    const byId = (id: string) => store.getAll().items.find((i) => i.id === id)!;
    assert.strictEqual(byId(c.id).order, 0);
    assert.strictEqual(byId(a.id).order, 1);
    assert.strictEqual(byId(b.id).order, 2);
  });

  test('moving into a different collection updates collectionId and renumbers both source and destination', async () => {
    const store = new BookmarkStore(new FakeMemento());
    const collection = await store.addCollection('Work');
    const a = await store.addItem({ type: 'file', uri: 'file:///a.txt' });
    const b = await store.addItem({ type: 'file', uri: 'file:///b.txt' });
    const existingInCollection = await store.addItem({ type: 'file', uri: 'file:///c.txt', collectionId: collection.id });

    await store.moveItem(a.id, collection.id, 0);

    const data = store.getAll();
    const byId = (id: string) => data.items.find((i) => i.id === id)!;

    assert.strictEqual(byId(a.id).collectionId, collection.id);
    assert.strictEqual(byId(a.id).order, 0);
    assert.strictEqual(byId(existingInCollection.id).order, 1);

    const remainingRoot = data.items.filter((i) => i.collectionId === null);
    assert.strictEqual(remainingRoot.length, 1);
    assert.strictEqual(remainingRoot[0].id, b.id);
    assert.strictEqual(remainingRoot[0].order, 0);
  });

  test('moveItem on an unknown id is a no-op', async () => {
    const store = new BookmarkStore(new FakeMemento());
    await store.addItem({ type: 'file', uri: 'file:///a.txt' });
    await store.moveItem('does-not-exist', null, 0);
    assert.strictEqual(store.getAll().items.length, 1);
  });

  test('moveItem clamps an out-of-range index into the valid range', async () => {
    const store = new BookmarkStore(new FakeMemento());
    const a = await store.addItem({ type: 'file', uri: 'file:///a.txt' });
    const b = await store.addItem({ type: 'file', uri: 'file:///b.txt' });

    await store.moveItem(a.id, null, 999);

    const remaining = store.getAll().items.sort((x, y) => x.order - y.order);
    assert.deepStrictEqual(remaining.map((i) => i.id), [b.id, a.id]);
  });
});
```

**Note on this task's cross-collection test:** it calls `store.addCollection(...)`, which doesn't exist until Step 3 below. This isn't forward-referencing an unbuilt Task 4 feature carelessly — it's real, working code being introduced one task early because `moveItem`'s own test suite needs a second collection to move into. Task 4 later extends the same method's neighbors (`renameCollection`/`deleteCollection`) on the same class; it does not replace or stub anything written here.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL at the `tsc` compile step (`pretest` runs `tsc -p .` over all of `src/**` before Mocha ever starts) — `Property 'moveItem' does not exist on type 'BookmarkStore'` and `Property 'addCollection' does not exist on type 'BookmarkStore'`. Neither test reaches a runtime assertion yet.

- [ ] **Step 3: Add `addCollection` to `bookmarkStore.ts`**

```ts
  async addCollection(name: string): Promise<BookmarkCollection> {
    const collection: BookmarkCollection = {
      id: randomUUID(),
      name,
      order: this.data.collections.length
    };
    this.data.collections.push(collection);
    await this.persist();
    return collection;
  }
```

- [ ] **Step 4: Re-run the tests to verify they now fail on `moveItem` specifically**

Run: `npm test`
Expected: FAIL at the `tsc` compile step — `Property 'moveItem' does not exist on type 'BookmarkStore'` (the `addCollection` compile error from Step 2 is gone).

- [ ] **Step 5: Implement `moveItem` (add to `bookmarkStore.ts`)**

```ts
  async moveItem(id: string, newCollectionId: string | null, newIndex: number): Promise<void> {
    const item = this.data.items.find((i) => i.id === id);
    if (!item) {
      return;
    }
    const oldCollectionId = item.collectionId;

    const oldSiblings = this.data.items.filter((i) => i.collectionId === oldCollectionId && i.id !== id);
    this.renumber(oldSiblings);

    item.collectionId = newCollectionId;
    const newSiblings = this.data.items
      .filter((i) => i.collectionId === newCollectionId && i.id !== id)
      .sort((a, b) => a.order - b.order);
    const clampedIndex = Math.max(0, Math.min(newIndex, newSiblings.length));
    newSiblings.splice(clampedIndex, 0, item);
    newSiblings.forEach((entry, index) => {
      entry.order = index;
    });

    await this.persist();
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: `14 passing`.

- [ ] **Step 7: Commit**

```bash
git add src/bookmarkStore.ts src/test/suite/bookmarkStore.test.ts
git commit -m "feat: add BookmarkStore.moveItem with cross-collection renumbering"
```

---

### Task 4: BookmarkStore — collections (rename, delete-with-atomicity)

**Files:**
- Modify: `src/bookmarkStore.ts`
- Test: `src/test/suite/bookmarkStore.test.ts`

**Interfaces:**
- Consumes: `addCollection` from Task 3 (extends its neighbors in the same class).
- Produces (used by Task 11's collection command handlers): `renameCollection(id: string, name: string): Promise<void>`, `deleteCollection(id: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests (append to `bookmarkStore.test.ts`)**

```ts
suite('BookmarkStore - collections', () => {
  test('addCollection assigns sequential order among collections', async () => {
    const store = new BookmarkStore(new FakeMemento());
    const first = await store.addCollection('Work');
    const second = await store.addCollection('Personal');
    assert.strictEqual(first.order, 0);
    assert.strictEqual(second.order, 1);
  });

  test('renameCollection updates the name without changing order', async () => {
    const store = new BookmarkStore(new FakeMemento());
    const collection = await store.addCollection('Work');
    await store.renameCollection(collection.id, 'Work Stuff');
    const updated = store.getAll().collections.find((c) => c.id === collection.id)!;
    assert.strictEqual(updated.name, 'Work Stuff');
    assert.strictEqual(updated.order, 0);
  });

  test('renameCollection on an unknown id is a no-op', async () => {
    const store = new BookmarkStore(new FakeMemento());
    await store.renameCollection('does-not-exist', 'X');
    assert.strictEqual(store.getAll().collections.length, 0);
  });

  test('deleteCollection ungroups its items instead of deleting them', async () => {
    const store = new BookmarkStore(new FakeMemento());
    const collection = await store.addCollection('Work');
    const item = await store.addItem({ type: 'file', uri: 'file:///a.txt', collectionId: collection.id });

    await store.deleteCollection(collection.id);

    const data = store.getAll();
    assert.strictEqual(data.collections.length, 0);
    assert.strictEqual(data.items.length, 1, 'items must not be deleted');
    assert.strictEqual(data.items.find((i) => i.id === item.id)!.collectionId, null);
  });

  test('deleteCollection performs the mutation as a single workspaceState.update() call', async () => {
    const memento = new FakeMemento();
    const store = new BookmarkStore(memento);
    const collection = await store.addCollection('Work');
    await store.addItem({ type: 'file', uri: 'file:///a.txt', collectionId: collection.id });
    await store.addItem({ type: 'file', uri: 'file:///b.txt', collectionId: collection.id });
    await store.addItem({ type: 'file', uri: 'file:///c.txt', collectionId: collection.id });

    const callsBefore = memento.updateCallCount;
    await store.deleteCollection(collection.id);

    assert.strictEqual(
      memento.updateCallCount - callsBefore,
      1,
      'deleting a 3-item collection must be exactly one update() call, not one per item'
    );
  });

  test('deleteCollection fires onBookmarksChanged exactly once', async () => {
    const store = new BookmarkStore(new FakeMemento());
    const collection = await store.addCollection('Work');
    await store.addItem({ type: 'file', uri: 'file:///a.txt', collectionId: collection.id });

    let fireCount = 0;
    store.onBookmarksChanged(() => { fireCount++; });
    await store.deleteCollection(collection.id);
    assert.strictEqual(fireCount, 1);
  });

  test('deleteCollection renumbers ungrouped items contiguously with any pre-existing root items', async () => {
    const store = new BookmarkStore(new FakeMemento());
    const rootItem = await store.addItem({ type: 'file', uri: 'file:///root.txt' });
    const collection = await store.addCollection('Work');
    const grouped = await store.addItem({ type: 'file', uri: 'file:///a.txt', collectionId: collection.id });

    await store.deleteCollection(collection.id);

    const data = store.getAll();
    const byId = (id: string) => data.items.find((i) => i.id === id)!;
    const orders = [byId(rootItem.id).order, byId(grouped.id).order].sort((a, b) => a - b);
    assert.deepStrictEqual(orders, [0, 1]);
  });

  test('deleteCollection on an unknown id is a no-op', async () => {
    const store = new BookmarkStore(new FakeMemento());
    await store.deleteCollection('does-not-exist');
    assert.strictEqual(store.getAll().collections.length, 0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL at the `tsc` compile step — `Property 'renameCollection' does not exist on type 'BookmarkStore'` (and likewise for `deleteCollection`).

- [ ] **Step 3: Implement `renameCollection` and `deleteCollection` (add to `bookmarkStore.ts`)**

```ts
  async renameCollection(id: string, name: string): Promise<void> {
    const collection = this.data.collections.find((c) => c.id === id);
    if (!collection) {
      return;
    }
    collection.name = name;
    await this.persist();
  }

  async deleteCollection(id: string): Promise<void> {
    const exists = this.data.collections.some((c) => c.id === id);
    if (!exists) {
      return;
    }
    this.data.collections = this.data.collections.filter((c) => c.id !== id);
    this.renumber(this.data.collections);

    let nextOrder = this.data.items.filter((i) => i.collectionId === null).length;
    for (const item of this.data.items) {
      if (item.collectionId === id) {
        item.collectionId = null;
        item.order = nextOrder++;
      }
    }

    await this.persist();
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: `22 passing`.

- [ ] **Step 5: Commit**

```bash
git add src/bookmarkStore.ts src/test/suite/bookmarkStore.test.ts
git commit -m "feat: add BookmarkStore.renameCollection and atomic deleteCollection"
```

---

### Task 5: FsGitCache — in-memory stat/repo cache

**Files:**
- Create: `src/fsGitCache.ts`
- Test: `src/test/suite/fsGitCache.test.ts`

**Interfaces:**
- Consumes: nothing (pure, dependency-injected — no `vscode` import).
- Produces (used by Task 6's real resolver, Task 7/8's tree provider, Task 12's `refresh` command): `interface CacheEntry { exists: boolean; repoName?: string }`, `type ResolveFn = (uri: string) => Promise<CacheEntry>`, `class FsGitCache` with `constructor(resolve: ResolveFn)`, `get(uri: string): Promise<CacheEntry>`, `invalidateAll(): void`.

- [ ] **Step 1: Write the failing tests — `src/test/suite/fsGitCache.test.ts`**

```ts
import * as assert from 'assert';
import { FsGitCache } from '../../fsGitCache';

suite('FsGitCache', () => {
  test('caches the resolved entry and does not call resolve twice for the same uri', async () => {
    let calls = 0;
    const cache = new FsGitCache(async () => {
      calls++;
      return { exists: true, repoName: 'repo-a' };
    });

    const first = await cache.get('file:///a.txt');
    const second = await cache.get('file:///a.txt');

    assert.deepStrictEqual(first, { exists: true, repoName: 'repo-a' });
    assert.deepStrictEqual(second, { exists: true, repoName: 'repo-a' });
    assert.strictEqual(calls, 1);
  });

  test('resolves different uris independently', async () => {
    const cache = new FsGitCache(async (uri) => ({ exists: true, repoName: uri }));
    const a = await cache.get('file:///a.txt');
    const b = await cache.get('file:///b.txt');
    assert.strictEqual(a.repoName, 'file:///a.txt');
    assert.strictEqual(b.repoName, 'file:///b.txt');
  });

  test('invalidateAll clears the cache so the next get() resolves again', async () => {
    let calls = 0;
    const cache = new FsGitCache(async () => {
      calls++;
      return { exists: true };
    });

    await cache.get('file:///a.txt');
    cache.invalidateAll();
    await cache.get('file:///a.txt');

    assert.strictEqual(calls, 2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../../fsGitCache'`.

- [ ] **Step 3: Write the minimal implementation — `src/fsGitCache.ts`**

```ts
export interface CacheEntry {
  exists: boolean;
  repoName?: string;
}

export type ResolveFn = (uri: string) => Promise<CacheEntry>;

export class FsGitCache {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly resolve: ResolveFn) {}

  async get(uri: string): Promise<CacheEntry> {
    const cached = this.cache.get(uri);
    if (cached) {
      return cached;
    }
    const entry = await this.resolve(uri);
    this.cache.set(uri, entry);
    return entry;
  }

  invalidateAll(): void {
    this.cache.clear();
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: `25 passing`.

- [ ] **Step 5: Commit**

```bash
git add src/fsGitCache.ts src/test/suite/fsGitCache.test.ts
git commit -m "feat: add FsGitCache in-memory stat/repo cache"
```

---

### Task 6: Git extension integration — activation race + repo-root resolution

**Files:**
- Create: `src/gitInfo.ts`
- Test: `src/test/suite/gitInfo.test.ts`

**Interfaces:**
- Consumes: nothing outside this task (dependency-injected `vscode.extensions.getExtension` lookup, for testability).
- Produces (used by Task 13's activation wiring): `interface GitRepository { rootUri: vscode.Uri }`, `interface GitApi { state; onDidChangeState; repositories: GitRepository[] }`, `interface GitExtensionExports { getAPI(version: 1): GitApi }`, `type GitApiFactory = () => Promise<GitApi | undefined>`, `function createGitApiFactory(lookupGitExtension: () => vscode.Extension<GitExtensionExports> | undefined, onFirstReady: () => void): GitApiFactory`, `function findRepoNameForUri(api: GitApi, uri: vscode.Uri): string | undefined`.

This directly implements the §4 "Git extension startup race" behavior: activate the extension, use `getAPI(1)` immediately if already `'initialized'`, otherwise wait on `onDidChangeState`; call `onFirstReady` exactly once, ever. It also resolves §3/§4/§6's "soft dependency" case: if `vscode.git` isn't installed, the factory resolves to `undefined` and nothing throws.

- [ ] **Step 1: Write the failing tests — `src/test/suite/gitInfo.test.ts`**

```ts
import * as assert from 'assert';
import * as vscode from 'vscode';
import { createGitApiFactory, findRepoNameForUri, GitApi, GitExtensionExports } from '../../gitInfo';

function makeFakeGitExtension(initialState: 'uninitialized' | 'initialized') {
  const emitter = new vscode.EventEmitter<'uninitialized' | 'initialized'>();
  let state: 'uninitialized' | 'initialized' = initialState;
  const api: GitApi = {
    get state() { return state; },
    onDidChangeState: emitter.event,
    repositories: []
  };
  const extension = {
    id: 'vscode.git',
    isActive: true,
    exports: { getAPI: (_v: 1) => api } as GitExtensionExports,
    activate: async () => extension.exports
  } as unknown as vscode.Extension<GitExtensionExports>;

  return {
    extension,
    setState(next: 'uninitialized' | 'initialized') {
      state = next;
      emitter.fire(next);
    }
  };
}

suite('gitInfo.createGitApiFactory', () => {
  test('returns undefined when vscode.git is not installed (soft dependency)', async () => {
    const factory = createGitApiFactory(
      () => undefined,
      () => { throw new Error('onFirstReady must not fire when the extension is missing'); }
    );
    const api = await factory();
    assert.strictEqual(api, undefined);
  });

  test('resolves immediately and fires onFirstReady exactly once when already initialized', async () => {
    const { extension } = makeFakeGitExtension('initialized');
    let readyCount = 0;
    const factory = createGitApiFactory(() => extension, () => { readyCount++; });

    const first = await factory();
    assert.ok(first);
    assert.strictEqual(readyCount, 1);

    const second = await factory();
    assert.ok(second);
    assert.strictEqual(readyCount, 1, 'onFirstReady must never fire a second time');
  });

  test('waits for onDidChangeState and fires onFirstReady exactly once on the first transition to initialized', async () => {
    const { extension, setState } = makeFakeGitExtension('uninitialized');
    let readyCount = 0;
    const factory = createGitApiFactory(() => extension, () => { readyCount++; });

    const pending = factory();
    setState('initialized');
    const api = await pending;

    assert.ok(api);
    assert.strictEqual(readyCount, 1);
  });
});

suite('gitInfo.findRepoNameForUri', () => {
  test('returns the basename of the longest matching repository root', () => {
    const api: GitApi = {
      state: 'initialized',
      onDidChangeState: new vscode.EventEmitter<'uninitialized' | 'initialized'>().event,
      repositories: [
        { rootUri: vscode.Uri.file('/workspace/repo-a') },
        { rootUri: vscode.Uri.file('/workspace/repo-a/nested-repo') }
      ]
    };

    const name = findRepoNameForUri(api, vscode.Uri.file('/workspace/repo-a/nested-repo/src/file.ts'));
    assert.strictEqual(name, 'nested-repo');
  });

  test('returns undefined when no repository contains the uri', () => {
    const api: GitApi = {
      state: 'initialized',
      onDidChangeState: new vscode.EventEmitter<'uninitialized' | 'initialized'>().event,
      repositories: [{ rootUri: vscode.Uri.file('/workspace/repo-a') }]
    };

    const name = findRepoNameForUri(api, vscode.Uri.file('/elsewhere/file.ts'));
    assert.strictEqual(name, undefined);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../../gitInfo'`.

- [ ] **Step 3: Write the minimal implementation — `src/gitInfo.ts`**

```ts
import * as vscode from 'vscode';
import * as path from 'path';

/** Minimal shim for the subset of the built-in vscode.git extension's API this extension consumes. */
export interface GitRepository {
  rootUri: vscode.Uri;
}

export interface GitApi {
  state: 'uninitialized' | 'initialized';
  onDidChangeState: vscode.Event<'uninitialized' | 'initialized'>;
  repositories: GitRepository[];
}

export interface GitExtensionExports {
  getAPI(version: 1): GitApi;
}

export type GitApiFactory = () => Promise<GitApi | undefined>;

/**
 * Activates the built-in vscode.git extension (if present) and resolves once its API
 * reports state === 'initialized'. Calls onFirstReady exactly once, the first time that
 * happens. Returns undefined — without ever calling onFirstReady — if the extension is
 * missing (the soft-dependency case from spec §3/§4/§6).
 */
export function createGitApiFactory(
  lookupGitExtension: () => vscode.Extension<GitExtensionExports> | undefined,
  onFirstReady: () => void
): GitApiFactory {
  let cachedApi: GitApi | undefined;
  let readyFired = false;

  const markReady = () => {
    if (!readyFired) {
      readyFired = true;
      onFirstReady();
    }
  };

  return async function getGitApi(): Promise<GitApi | undefined> {
    if (cachedApi && cachedApi.state === 'initialized') {
      return cachedApi;
    }

    const ext = lookupGitExtension();
    if (!ext) {
      return undefined;
    }

    const exports = ext.isActive ? ext.exports : await ext.activate();
    const api = exports.getAPI(1);
    cachedApi = api;

    if (api.state === 'initialized') {
      markReady();
      return api;
    }

    return new Promise((resolve) => {
      const subscription = api.onDidChangeState((state) => {
        if (state === 'initialized') {
          subscription.dispose();
          markReady();
          resolve(api);
        }
      });
    });
  };
}

/** Finds the repository (if any) whose root contains `uri`, preferring the deepest (longest) match. */
export function findRepoNameForUri(api: GitApi, uri: vscode.Uri): string | undefined {
  let best: GitRepository | undefined;
  for (const repo of api.repositories) {
    const rootPath = repo.rootUri.fsPath;
    const isMatch = uri.fsPath === rootPath || uri.fsPath.startsWith(rootPath + path.sep);
    if (isMatch && (!best || rootPath.length > best.rootUri.fsPath.length)) {
      best = repo;
    }
  }
  return best ? path.basename(best.rootUri.fsPath) : undefined;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: `30 passing`.

- [ ] **Step 5: Commit**

```bash
git add src/gitInfo.ts src/test/suite/gitInfo.test.ts
git commit -m "feat: add vscode.git soft-dependency activation race handling and repo resolution"
```

---

### Task 7: BookmarksTreeDataProvider — default mode rendering

**Files:**
- Create: `src/bookmarksTreeDataProvider.ts`
- Test: `src/test/suite/bookmarksTreeDataProvider.test.ts`

**Interfaces:**
- Consumes: `BookmarkStore` (Task 2-4), `FsGitCache` (Task 5).
- Produces (used by Task 8, 9, 12, 13): `type GroupMode = 'default' | 'byRepo'`, `type BookmarkNode = { kind: 'collection'; collection: BookmarkCollection; repoLabel?: string } | { kind: 'item'; item: BookmarkItem } | { kind: 'repoGroup'; label: string }`, `const DND_MIME_TYPE = 'application/vnd.code.tree.bookmarksview'`, `class BookmarksTreeDataProvider implements vscode.TreeDataProvider<BookmarkNode>` with `getGroupMode()`, `setGroupMode(mode)`, `refresh()`, `getTreeItem(node)`, `getChildren(node?)`, plus the `TreeDragAndDropController` members added in Task 9.

- [ ] **Step 1: Write the failing tests — `src/test/suite/bookmarksTreeDataProvider.test.ts`**

```ts
import * as assert from 'assert';
import * as vscode from 'vscode';
import { BookmarkStore } from '../../bookmarkStore';
import { FsGitCache } from '../../fsGitCache';
import { BookmarksTreeDataProvider, BookmarkNode } from '../../bookmarksTreeDataProvider';
import { FakeMemento } from './fixtures';

function makeProvider(resolve: (uri: string) => Promise<{ exists: boolean; repoName?: string }> = async () => ({ exists: true })) {
  const store = new BookmarkStore(new FakeMemento());
  const cache = new FsGitCache(resolve);
  const provider = new BookmarksTreeDataProvider(store, cache);
  return { store, cache, provider };
}

suite('BookmarksTreeDataProvider - default mode', () => {
  test('empty store yields no root children', async () => {
    const { provider } = makeProvider();
    const children = await provider.getChildren();
    assert.deepStrictEqual(children, []);
  });

  test('root shows collections before ungrouped items, each sorted by order', async () => {
    const { store, provider } = makeProvider();
    await store.addCollection('Work');
    await store.addItem({ type: 'file', uri: 'file:///a.txt' });
    await store.addItem({ type: 'file', uri: 'file:///b.txt' });

    const children = await provider.getChildren();
    assert.strictEqual(children.length, 3);
    assert.strictEqual(children[0].kind, 'collection');
    assert.strictEqual(children[1].kind, 'item');
    assert.strictEqual(children[2].kind, 'item');
  });

  test('a collection node lists only its own items', async () => {
    const { store, provider } = makeProvider();
    const collection = await store.addCollection('Work');
    await store.addItem({ type: 'file', uri: 'file:///a.txt', collectionId: collection.id });
    await store.addItem({ type: 'file', uri: 'file:///b.txt' }); // root item — must not appear

    const node: BookmarkNode = { kind: 'collection', collection };
    const children = await provider.getChildren(node);

    assert.strictEqual(children.length, 1);
    assert.strictEqual(children[0].kind, 'item');
  });

  test('a folder bookmark tree item is always a leaf (collapsibleState None) and has no children', async () => {
    const { store, provider } = makeProvider();
    const folder = await store.addItem({ type: 'folder', uri: 'file:///dir' });
    const node: BookmarkNode = { kind: 'item', item: folder };

    const treeItem = await provider.getTreeItem(node);
    assert.strictEqual(treeItem.collapsibleState, vscode.TreeItemCollapsibleState.None);

    const children = await provider.getChildren(node);
    assert.deepStrictEqual(children, []);
  });

  test('a broken bookmark renders with a warning icon and does not throw', async () => {
    const { store, provider } = makeProvider(async () => ({ exists: false }));
    const item = await store.addItem({ type: 'file', uri: 'file:///missing.txt' });
    const node: BookmarkNode = { kind: 'item', item };

    const treeItem = await provider.getTreeItem(node);
    assert.ok(treeItem.iconPath instanceof vscode.ThemeIcon);
    assert.strictEqual((treeItem.iconPath as vscode.ThemeIcon).id, 'warning');
  });

  test('a valid bookmark with a resolved repo shows the repo name as its description', async () => {
    const { store, provider } = makeProvider(async () => ({ exists: true, repoName: 'my-repo' }));
    const item = await store.addItem({ type: 'file', uri: 'file:///a.txt' });
    const treeItem = await provider.getTreeItem({ kind: 'item', item });
    assert.strictEqual(treeItem.description, 'my-repo');
  });

  test('file bookmark tree item opens the file directly, bypassing bookmarks.reveal', async () => {
    const { store, provider } = makeProvider();
    const item = await store.addItem({ type: 'file', uri: 'file:///a.txt' });
    const treeItem = await provider.getTreeItem({ kind: 'item', item });
    assert.strictEqual(treeItem.command?.command, 'vscode.open');
  });

  test('folder bookmark tree item triggers bookmarks.reveal (its only possible click target)', async () => {
    const { store, provider } = makeProvider();
    const item = await store.addItem({ type: 'folder', uri: 'file:///dir' });
    const treeItem = await provider.getTreeItem({ kind: 'item', item });
    assert.strictEqual(treeItem.command?.command, 'bookmarks.reveal');
  });

  test('re-fires onDidChangeTreeData and invalidates the cache when the store changes', async () => {
    let resolveCalls = 0;
    const { store, provider } = makeProvider(async () => { resolveCalls++; return { exists: true }; });

    const item = await store.addItem({ type: 'file', uri: 'file:///a.txt' });
    await provider.getTreeItem({ kind: 'item', item });
    assert.strictEqual(resolveCalls, 1);

    let redraws = 0;
    provider.onDidChangeTreeData(() => { redraws++; });
    await store.addItem({ type: 'file', uri: 'file:///b.txt' });
    assert.strictEqual(redraws, 1);

    await provider.getTreeItem({ kind: 'item', item });
    assert.strictEqual(resolveCalls, 2, 'the cache must be invalidated on onBookmarksChanged');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../../bookmarksTreeDataProvider'`.

- [ ] **Step 3: Write the minimal implementation — `src/bookmarksTreeDataProvider.ts`** (default-mode pieces only; group-by-repo and drag-and-drop are added in Tasks 8-9)

```ts
import * as vscode from 'vscode';
import * as path from 'path';
import { BookmarkStore } from './bookmarkStore';
import { BookmarkItem, BookmarkCollection } from './types';
import { FsGitCache } from './fsGitCache';

export type GroupMode = 'default' | 'byRepo';

export type BookmarkNode =
  | { kind: 'collection'; collection: BookmarkCollection; repoLabel?: string }
  | { kind: 'item'; item: BookmarkItem }
  | { kind: 'repoGroup'; label: string };

export const DND_MIME_TYPE = 'application/vnd.code.tree.bookmarksview';
export const UNKNOWN_REPO_LABEL = 'Unknown';

export class BookmarksTreeDataProvider implements vscode.TreeDataProvider<BookmarkNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<BookmarkNode | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<BookmarkNode | undefined | void> = this._onDidChangeTreeData.event;

  private groupMode: GroupMode = 'default';

  constructor(
    private readonly store: BookmarkStore,
    private readonly cache: FsGitCache
  ) {
    this.store.onBookmarksChanged(() => {
      this.cache.invalidateAll();
      this._onDidChangeTreeData.fire();
    });
  }

  getGroupMode(): GroupMode {
    return this.groupMode;
  }

  setGroupMode(mode: GroupMode): void {
    this.groupMode = mode;
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    this.cache.invalidateAll();
    this._onDidChangeTreeData.fire();
  }

  async getTreeItem(node: BookmarkNode): Promise<vscode.TreeItem> {
    if (node.kind === 'repoGroup') {
      const treeItem = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
      treeItem.contextValue = 'bookmarkRepoGroup';
      treeItem.iconPath = new vscode.ThemeIcon('repo');
      return treeItem;
    }

    if (node.kind === 'collection') {
      const treeItem = new vscode.TreeItem(node.collection.name, vscode.TreeItemCollapsibleState.Collapsed);
      treeItem.contextValue = 'bookmarkCollection';
      treeItem.id = node.repoLabel ? `collection:${node.repoLabel}:${node.collection.id}` : `collection:${node.collection.id}`;
      return treeItem;
    }

    const bookmark = node.item;
    const uri = vscode.Uri.parse(bookmark.uri);
    const entry = await this.cache.get(bookmark.uri);
    const label = path.basename(uri.fsPath) || uri.fsPath;

    const treeItem = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    treeItem.id = `item:${bookmark.id}`;
    treeItem.contextValue = 'bookmarkItem';
    treeItem.resourceUri = uri;

    if (!entry.exists) {
      treeItem.iconPath = new vscode.ThemeIcon('warning');
      treeItem.description = 'missing';
    } else {
      treeItem.iconPath = new vscode.ThemeIcon(bookmark.type === 'folder' ? 'folder' : 'file');
      if (entry.repoName) {
        treeItem.description = entry.repoName;
      }
    }

    treeItem.command =
      bookmark.type === 'file'
        ? { command: 'vscode.open', title: 'Open', arguments: [uri] }
        : { command: 'bookmarks.reveal', title: 'Reveal in Explorer', arguments: [node] };

    return treeItem;
  }

  async getChildren(node?: BookmarkNode): Promise<BookmarkNode[]> {
    const data = this.store.getAll();

    if (this.groupMode === 'byRepo') {
      return this.getChildrenByRepo(node, data.items, data.collections);
    }
    return this.getChildrenDefault(node, data.items, data.collections);
  }

  private getChildrenDefault(
    node: BookmarkNode | undefined,
    items: BookmarkItem[],
    collections: BookmarkCollection[]
  ): BookmarkNode[] {
    if (!node) {
      const collectionNodes: BookmarkNode[] = [...collections]
        .sort((a, b) => a.order - b.order)
        .map((collection) => ({ kind: 'collection', collection }));
      const rootItemNodes: BookmarkNode[] = items
        .filter((i) => i.collectionId === null)
        .sort((a, b) => a.order - b.order)
        .map((item) => ({ kind: 'item', item }));
      return [...collectionNodes, ...rootItemNodes];
    }

    if (node.kind === 'collection') {
      return items
        .filter((i) => i.collectionId === node.collection.id)
        .sort((a, b) => a.order - b.order)
        .map((item) => ({ kind: 'item', item }));
    }

    return [];
  }

  // getChildrenByRepo is added in Task 8.
  private async getChildrenByRepo(
    _node: BookmarkNode | undefined,
    _items: BookmarkItem[],
    _collections: BookmarkCollection[]
  ): Promise<BookmarkNode[]> {
    return [];
  }
}
```

**Design note (root ordering, not specified further by the spec):** §4 says "Collections render as parent nodes; ungrouped items render at the root" but does not say how collections and root items interleave, since each has its own independent `order` sequence (§3). This plan renders all collections first (by their own order), then all ungrouped items (by their own order) — a deliberate, simple choice consistent with the spec's overall simplicity stance, not a contradiction of anything stated.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: `39 passing`.

- [ ] **Step 5: Commit**

```bash
git add src/bookmarksTreeDataProvider.ts src/test/suite/bookmarksTreeDataProvider.test.ts
git commit -m "feat: add BookmarksTreeDataProvider default-mode rendering"
```

---

### Task 8: BookmarksTreeDataProvider — group-by-repo mode

**Files:**
- Modify: `src/bookmarksTreeDataProvider.ts`
- Test: `src/test/suite/bookmarksTreeDataProvider.test.ts`

**Interfaces:**
- Consumes: `BookmarkNode`, `UNKNOWN_REPO_LABEL` from Task 7 (same file/class, extends `getChildrenByRepo`).
- Produces: nothing new externally — `getChildren` now fully honors `groupMode === 'byRepo'`.

- [ ] **Step 1: Write the failing tests (append to `bookmarksTreeDataProvider.test.ts`)**

```ts
suite('BookmarksTreeDataProvider - group-by-repo mode', () => {
  test('an item with no resolvable repo falls into the Unknown group without throwing', async () => {
    const { store, provider } = makeProvider(async () => ({ exists: true, repoName: undefined }));
    provider.setGroupMode('byRepo');
    await store.addItem({ type: 'file', uri: 'file:///a.txt' });

    const roots = await provider.getChildren();
    assert.strictEqual(roots.length, 1);
    assert.strictEqual(roots[0].kind, 'repoGroup');
    assert.strictEqual((roots[0] as { label: string }).label, 'Unknown');
  });

  test('a broken item also falls into the Unknown group in group-by-repo mode', async () => {
    const { store, provider } = makeProvider(async () => ({ exists: false }));
    provider.setGroupMode('byRepo');
    await store.addItem({ type: 'file', uri: 'file:///missing.txt' });

    const roots = await provider.getChildren();
    assert.strictEqual(roots.length, 1);
    assert.strictEqual((roots[0] as { label: string }).label, 'Unknown');
  });

  test('degrades to an all-Unknown render (no throw) when no active git repository is found', async () => {
    const { store, provider } = makeProvider(async () => ({ exists: true })); // simulates vscode.git unavailable
    provider.setGroupMode('byRepo');
    await store.addItem({ type: 'file', uri: 'file:///a.txt' });
    await store.addItem({ type: 'file', uri: 'file:///b.txt' });

    const roots = await provider.getChildren();
    assert.strictEqual(roots.length, 1);
    assert.strictEqual((roots[0] as { label: string }).label, 'Unknown');
  });

  test('groups items under their resolved repo, nested by collection, and each repo only sees its own items', async () => {
    const { store, provider } = makeProvider(async (uri) => ({
      exists: true,
      repoName: uri.includes('repo-a') ? 'repo-a' : 'repo-b'
    }));
    provider.setGroupMode('byRepo');

    const collection = await store.addCollection('Work');
    await store.addItem({ type: 'file', uri: 'file:///repo-a/x.txt', collectionId: collection.id });
    await store.addItem({ type: 'file', uri: 'file:///repo-b/y.txt', collectionId: collection.id });
    await store.addItem({ type: 'file', uri: 'file:///repo-a/z.txt' });

    const roots = await provider.getChildren();
    assert.strictEqual(roots.length, 2);

    const repoA = roots.find((n) => (n as { label: string }).label === 'repo-a')!;
    const repoAChildren = await provider.getChildren(repoA);
    // repo-a has one collection-with-items and one root item.
    assert.strictEqual(repoAChildren.length, 2);
    const repoACollection = repoAChildren.find((n) => n.kind === 'collection')!;

    const itemsInRepoACollection = await provider.getChildren(repoACollection);
    assert.strictEqual(itemsInRepoACollection.length, 1);
    assert.strictEqual((itemsInRepoACollection[0] as { item: { uri: string } }).item.uri, 'file:///repo-a/x.txt');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `getChildrenByRepo` currently always returns `[]`.

- [ ] **Step 3: Implement `getChildrenByRepo` (replace the stub in `bookmarksTreeDataProvider.ts`)**

```ts
  private async getChildrenByRepo(
    node: BookmarkNode | undefined,
    items: BookmarkItem[],
    collections: BookmarkCollection[]
  ): Promise<BookmarkNode[]> {
    if (!node) {
      const labels = new Set<string>();
      for (const item of items) {
        const entry = await this.cache.get(item.uri);
        labels.add(entry.repoName ?? UNKNOWN_REPO_LABEL);
      }
      return [...labels]
        .sort((a, b) => {
          if (a === UNKNOWN_REPO_LABEL) return 1;
          if (b === UNKNOWN_REPO_LABEL) return -1;
          return a.localeCompare(b);
        })
        .map((label) => ({ kind: 'repoGroup', label }));
    }

    if (node.kind === 'repoGroup') {
      const itemsInRepo: BookmarkItem[] = [];
      for (const item of items) {
        const entry = await this.cache.get(item.uri);
        if ((entry.repoName ?? UNKNOWN_REPO_LABEL) === node.label) {
          itemsInRepo.push(item);
        }
      }
      const collectionIdsInRepo = new Set(
        itemsInRepo.map((i) => i.collectionId).filter((id): id is string => id !== null)
      );
      const collectionNodes: BookmarkNode[] = collections
        .filter((c) => collectionIdsInRepo.has(c.id))
        .sort((a, b) => a.order - b.order)
        .map((collection) => ({ kind: 'collection', collection, repoLabel: node.label }));
      const rootItemNodes: BookmarkNode[] = itemsInRepo
        .filter((i) => i.collectionId === null)
        .sort((a, b) => a.order - b.order)
        .map((item) => ({ kind: 'item', item }));
      return [...collectionNodes, ...rootItemNodes];
    }

    if (node.kind === 'collection') {
      const repoLabel = node.repoLabel ?? UNKNOWN_REPO_LABEL;
      const candidates = items.filter((i) => i.collectionId === node.collection.id);
      const matched: BookmarkItem[] = [];
      for (const item of candidates) {
        const entry = await this.cache.get(item.uri);
        if ((entry.repoName ?? UNKNOWN_REPO_LABEL) === repoLabel) {
          matched.push(item);
        }
      }
      return matched.sort((a, b) => a.order - b.order).map((item) => ({ kind: 'item', item }));
    }

    return [];
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: `43 passing`.

- [ ] **Step 5: Commit**

```bash
git add src/bookmarksTreeDataProvider.ts src/test/suite/bookmarksTreeDataProvider.test.ts
git commit -m "feat: add group-by-repo rendering with Unknown bucket for unresolved items"
```

---

### Task 9: TreeDragAndDropController — reorder, cross-collection move, disabled in group-by-repo

**Files:**
- Modify: `src/bookmarksTreeDataProvider.ts`
- Test: `src/test/suite/bookmarksTreeDataProvider.test.ts`

**Interfaces:**
- Consumes: `DND_MIME_TYPE`, `BookmarkNode` (Task 7), `BookmarkStore.moveItem` (Task 3).
- Produces (used by Task 13's `vscode.window.createTreeView` call): `BookmarksTreeDataProvider` now also `implements vscode.TreeDragAndDropController<BookmarkNode>`, with `dropMimeTypes`, `dragMimeTypes`, `handleDrag(source, dataTransfer, token)`, `handleDrop(target, dataTransfer, token)`.

- [ ] **Step 1: Write the failing tests (append to `bookmarksTreeDataProvider.test.ts`)**

```ts
function makeDropTransfer(ids: string[]): vscode.DataTransfer {
  const dt = new vscode.DataTransfer();
  dt.set(DND_MIME_TYPE, new vscode.DataTransferItem(ids));
  return dt;
}

suite('BookmarksTreeDataProvider - drag and drop', () => {
  test('dropping with no target appends the item to the root, at the end', async () => {
    const { store, provider } = makeProvider();
    const a = await store.addItem({ type: 'file', uri: 'file:///a.txt' });
    const b = await store.addItem({ type: 'file', uri: 'file:///b.txt' });

    const token = new vscode.CancellationTokenSource().token;
    await provider.handleDrop(undefined, makeDropTransfer([a.id]), token);

    const data = store.getAll();
    const byId = (id: string) => data.items.find((i) => i.id === id)!;
    assert.strictEqual(byId(a.id).collectionId, null);
    assert.strictEqual(byId(a.id).order, 1);
    assert.strictEqual(byId(b.id).order, 0);
  });

  test('dropping on a collection node moves the item into it', async () => {
    const { store, provider } = makeProvider();
    const collection = await store.addCollection('Work');
    const item = await store.addItem({ type: 'file', uri: 'file:///a.txt' });
    const other = await store.addItem({ type: 'file', uri: 'file:///b.txt' });

    const targetNode: BookmarkNode = { kind: 'collection', collection };
    const token = new vscode.CancellationTokenSource().token;
    await provider.handleDrop(targetNode, makeDropTransfer([item.id]), token);

    const data = store.getAll();
    const moved = data.items.find((i) => i.id === item.id)!;
    const remainingRoot = data.items.filter((i) => i.collectionId === null);

    assert.strictEqual(moved.collectionId, collection.id);
    assert.strictEqual(remainingRoot.length, 1);
    assert.strictEqual(remainingRoot[0].id, other.id);
    assert.strictEqual(remainingRoot[0].order, 0);
  });

  test('dropping on a sibling item reorders within the same parent', async () => {
    const { store, provider } = makeProvider();
    const a = await store.addItem({ type: 'file', uri: 'file:///a.txt' });
    const b = await store.addItem({ type: 'file', uri: 'file:///b.txt' });
    const c = await store.addItem({ type: 'file', uri: 'file:///c.txt' });

    const targetNode: BookmarkNode = { kind: 'item', item: a }; // drop c onto a's position
    const token = new vscode.CancellationTokenSource().token;
    await provider.handleDrop(targetNode, makeDropTransfer([c.id]), token);

    const data = store.getAll();
    const byId = (id: string) => data.items.find((i) => i.id === id)!;
    assert.strictEqual(byId(c.id).order, 0);
    assert.strictEqual(byId(a.id).order, 1);
    assert.strictEqual(byId(b.id).order, 2);
  });

  test('drag and drop are disabled in group-by-repo mode', async () => {
    const { store, provider } = makeProvider();
    provider.setGroupMode('byRepo');
    const item = await store.addItem({ type: 'file', uri: 'file:///a.txt' });

    const token = new vscode.CancellationTokenSource().token;
    await provider.handleDrop(undefined, makeDropTransfer([item.id]), token);

    const untouched = store.getAll().items.find((i) => i.id === item.id)!;
    assert.strictEqual(untouched.collectionId, null);
    assert.strictEqual(untouched.order, 0);
  });

  test('handleDrag is disabled in group-by-repo mode and sets no transfer data', async () => {
    const { store, provider } = makeProvider();
    provider.setGroupMode('byRepo');
    const item = await store.addItem({ type: 'file', uri: 'file:///a.txt' });

    const dt = new vscode.DataTransfer();
    const token = new vscode.CancellationTokenSource().token;
    await provider.handleDrag([{ kind: 'item', item }], dt, token);

    assert.strictEqual(dt.get(DND_MIME_TYPE), undefined);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL at the `tsc` compile step — `Property 'handleDrop' does not exist on type 'BookmarksTreeDataProvider'` (and likewise for `handleDrag`).

- [ ] **Step 3: Implement drag-and-drop (add to `BookmarksTreeDataProvider` in `bookmarksTreeDataProvider.ts`)**

```ts
// Change the class declaration to:
// export class BookmarksTreeDataProvider implements vscode.TreeDataProvider<BookmarkNode>, vscode.TreeDragAndDropController<BookmarkNode> {

  readonly dropMimeTypes = [DND_MIME_TYPE];
  readonly dragMimeTypes = [DND_MIME_TYPE];

  async handleDrag(
    source: readonly BookmarkNode[],
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): Promise<void> {
    if (this.groupMode === 'byRepo') {
      return; // DnD disabled in group-by-repo mode (spec §4).
    }
    const ids = source.filter((n): n is Extract<BookmarkNode, { kind: 'item' }> => n.kind === 'item').map((n) => n.item.id);
    if (ids.length === 0) {
      return;
    }
    dataTransfer.set(DND_MIME_TYPE, new vscode.DataTransferItem(ids));
  }

  async handleDrop(
    target: BookmarkNode | undefined,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): Promise<void> {
    if (this.groupMode === 'byRepo') {
      return; // DnD disabled in group-by-repo mode (spec §4).
    }
    const transferItem = dataTransfer.get(DND_MIME_TYPE);
    if (!transferItem) {
      return;
    }
    const ids: string[] = transferItem.value;
    const data = this.store.getAll();

    let newCollectionId: string | null;
    let newIndex: number;

    if (!target) {
      newCollectionId = null;
      newIndex = data.items.filter((i) => i.collectionId === null).length;
    } else if (target.kind === 'collection') {
      newCollectionId = target.collection.id;
      newIndex = data.items.filter((i) => i.collectionId === target.collection.id).length;
    } else if (target.kind === 'item') {
      newCollectionId = target.item.collectionId;
      newIndex = target.item.order;
    } else {
      return; // repoGroup nodes are not a valid drop target.
    }

    for (const id of ids) {
      // Calls the exact same BookmarkStore.moveItem() path every command handler uses (spec §2) —
      // there is no special-case write path for drag-and-drop.
      await this.store.moveItem(id, newCollectionId, newIndex);
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: `48 passing`.

- [ ] **Step 5: Commit**

```bash
git add src/bookmarksTreeDataProvider.ts src/test/suite/bookmarksTreeDataProvider.test.ts
git commit -m "feat: add TreeDragAndDropController, disabled in group-by-repo mode"
```

---

### Task 10: Commands — addFile / addFolder / remove / reveal

**Files:**
- Create: `src/commands.ts`
- Test: `src/test/suite/commands.test.ts`

**Interfaces:**
- Consumes: `BookmarkStore` (Task 2-4), `BookmarkNode` (Task 7).
- Produces (used by Task 11-12, and Task 13's activation wiring): `createAddFileHandler(store)`, `createAddFolderHandler(store)`, `createRemoveHandler(store)`, `createRevealHandler(reveal: (uri: vscode.Uri) => Thenable<unknown>)`, `registerAddCommands(context, store)`, `registerItemCommands(context, store)`.

Every handler is exported as a small factory that takes its dependencies as plain function arguments — this lets tests call the handler directly with fakes, with no global monkey-patching and no mocking library.

- [ ] **Step 1: Write the failing tests — `src/test/suite/commands.test.ts`**

```ts
import * as assert from 'assert';
import * as vscode from 'vscode';
import { BookmarkStore } from '../../bookmarkStore';
import { BookmarkNode } from '../../bookmarksTreeDataProvider';
import { BookmarkItem } from '../../types';
import {
  createAddFileHandler,
  createAddFolderHandler,
  createRemoveHandler,
  createRevealHandler
} from '../../commands';
import { FakeMemento } from './fixtures';

suite('commands - addFile / addFolder / remove / reveal', () => {
  test('addFile handler adds a root-level file bookmark for the given uri', async () => {
    const store = new BookmarkStore(new FakeMemento());
    const uri = vscode.Uri.file('/workspace/a.txt');
    await createAddFileHandler(store)(uri);

    const items = store.getAll().items;
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].type, 'file');
    assert.strictEqual(items[0].uri, uri.toString());
  });

  test('addFolder handler adds a root-level folder bookmark for the given uri', async () => {
    const store = new BookmarkStore(new FakeMemento());
    const uri = vscode.Uri.file('/workspace/dir');
    await createAddFolderHandler(store)(uri);

    const items = store.getAll().items;
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].type, 'folder');
  });

  test('remove handler deletes the targeted item and ignores non-item nodes', async () => {
    const store = new BookmarkStore(new FakeMemento());
    const item = await store.addItem({ type: 'file', uri: 'file:///a.txt' });
    const handler = createRemoveHandler(store);

    await handler({ kind: 'repoGroup', label: 'x' });
    assert.strictEqual(store.getAll().items.length, 1, 'non-item nodes must be a no-op');

    await handler({ kind: 'item', item });
    assert.strictEqual(store.getAll().items.length, 0);
  });

  test('reveal handler calls the injected reveal function with the item uri', async () => {
    const calls: string[] = [];
    const handler = createRevealHandler(async (uri) => { calls.push(uri.toString()); });
    const item: BookmarkItem = { id: '1', type: 'file', uri: 'file:///a.txt', collectionId: null, order: 0 };

    await handler({ kind: 'item', item });
    assert.deepStrictEqual(calls, ['file:///a.txt']);
  });

  test('reveal handler works identically for folder items', async () => {
    const calls: string[] = [];
    const handler = createRevealHandler(async (uri) => { calls.push(uri.toString()); });
    const item: BookmarkItem = { id: '2', type: 'folder', uri: 'file:///dir', collectionId: null, order: 0 };

    await handler({ kind: 'item', item });
    assert.deepStrictEqual(calls, ['file:///dir']);
  });

  test('reveal handler is a no-op for non-item nodes', async () => {
    let called = false;
    const handler = createRevealHandler(async () => { called = true; });
    await handler({ kind: 'repoGroup', label: 'x' });
    assert.strictEqual(called, false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../../commands'`.

- [ ] **Step 3: Write the minimal implementation — `src/commands.ts`** (this task's exports only; Tasks 11-12 add more to the same file)

```ts
import * as vscode from 'vscode';
import { BookmarkStore } from './bookmarkStore';
import { BookmarkNode } from './bookmarksTreeDataProvider';

export function createAddFileHandler(store: BookmarkStore) {
  return async (uri: vscode.Uri) => {
    await store.addItem({ type: 'file', uri: uri.toString() });
  };
}

export function createAddFolderHandler(store: BookmarkStore) {
  return async (uri: vscode.Uri) => {
    await store.addItem({ type: 'folder', uri: uri.toString() });
  };
}

export function createRemoveHandler(store: BookmarkStore) {
  return async (node: BookmarkNode) => {
    if (node.kind !== 'item') {
      return;
    }
    await store.removeItem(node.item.id);
  };
}

export function createRevealHandler(reveal: (uri: vscode.Uri) => Thenable<unknown>) {
  return async (node: BookmarkNode) => {
    if (node.kind !== 'item') {
      return;
    }
    await reveal(vscode.Uri.parse(node.item.uri));
  };
}

export function registerAddCommands(context: vscode.ExtensionContext, store: BookmarkStore): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('bookmarks.addFile', createAddFileHandler(store)),
    vscode.commands.registerCommand('bookmarks.addFolder', createAddFolderHandler(store))
  );
}

export function registerItemCommands(context: vscode.ExtensionContext, store: BookmarkStore): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('bookmarks.remove', createRemoveHandler(store)),
    vscode.commands.registerCommand(
      'bookmarks.reveal',
      createRevealHandler((uri) => vscode.commands.executeCommand('revealInExplorer', uri))
    )
  );
}
```

**Design note (§5 reconciliation, see the top-level "spec ambiguities" section):** `bookmarks.reveal`'s handler here always calls `revealInExplorer`, for both file and folder items — matching the §5 table cell literally. The file-vs-folder click distinction from the prose right below the table is implemented one layer up, in Task 7's `getTreeItem` (`vscode.open` for files, `bookmarks.reveal` for folders) — a file's row click never reaches this handler at all.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: `54 passing`.

- [ ] **Step 5: Commit**

```bash
git add src/commands.ts src/test/suite/commands.test.ts
git commit -m "feat: add addFile/addFolder/remove/reveal command handlers"
```

---

### Task 11: Commands — collections (new / rename / delete / moveToCollection)

**Files:**
- Modify: `src/commands.ts`
- Test: `src/test/suite/commands.test.ts`

**Interfaces:**
- Consumes: `BookmarkStore` (Task 2-4), `BookmarkNode` (Task 7).
- Produces (used by Task 13's activation wiring): `interface Prompter { showInputBox; showQuickPick; showWarningConfirm }`, `createNewCollectionHandler(store, prompter)`, `createRenameCollectionHandler(store, prompter)`, `createDeleteCollectionHandler(store, prompter)`, `createMoveToCollectionHandler(store, prompter)`, `registerCollectionCommands(context, store)`.

`Prompter` exists so every collection command is testable without driving real VS Code input boxes/quick picks — tests supply a fake `Prompter`, production code supplies one backed by `vscode.window`.

- [ ] **Step 1: Write the failing tests (append to `commands.test.ts`)**

```ts
import {
  Prompter,
  createNewCollectionHandler,
  createRenameCollectionHandler,
  createDeleteCollectionHandler,
  createMoveToCollectionHandler
} from '../../commands';

function makePrompter(overrides: Partial<Prompter> = {}): Prompter {
  return {
    showInputBox: async () => undefined,
    showQuickPick: async () => undefined,
    showWarningConfirm: async () => false,
    ...overrides
  };
}

suite('commands - collections', () => {
  test('newCollection handler creates a collection with the prompted name', async () => {
    const store = new BookmarkStore(new FakeMemento());
    const prompter = makePrompter({ showInputBox: async () => 'Work' });

    await createNewCollectionHandler(store, prompter)();

    const collections = store.getAll().collections;
    assert.strictEqual(collections.length, 1);
    assert.strictEqual(collections[0].name, 'Work');
  });

  test('newCollection handler does nothing when the prompt is cancelled', async () => {
    const store = new BookmarkStore(new FakeMemento());
    await createNewCollectionHandler(store, makePrompter())();
    assert.strictEqual(store.getAll().collections.length, 0);
  });

  test('renameCollection handler renames the targeted collection', async () => {
    const store = new BookmarkStore(new FakeMemento());
    const collection = await store.addCollection('Work');
    const prompter = makePrompter({ showInputBox: async () => 'Work Stuff' });

    await createRenameCollectionHandler(store, prompter)({ kind: 'collection', collection });

    assert.strictEqual(store.getAll().collections[0].name, 'Work Stuff');
  });

  test('renameCollection handler ignores non-collection nodes', async () => {
    const store = new BookmarkStore(new FakeMemento());
    const item = await store.addItem({ type: 'file', uri: 'file:///a.txt' });
    const prompter = makePrompter({ showInputBox: async () => 'Whatever' });

    await createRenameCollectionHandler(store, prompter)({ kind: 'item', item });
    // No collections exist, so nothing to assert on except that this did not throw.
    assert.strictEqual(store.getAll().collections.length, 0);
  });

  test('deleteCollection handler only ungroups items after confirmation', async () => {
    const store = new BookmarkStore(new FakeMemento());
    const collection = await store.addCollection('Work');
    const item = await store.addItem({ type: 'file', uri: 'file:///a.txt', collectionId: collection.id });

    const declining = makePrompter({ showWarningConfirm: async () => false });
    await createDeleteCollectionHandler(store, declining)({ kind: 'collection', collection });
    assert.strictEqual(store.getAll().collections.length, 1, 'declined confirmation must not delete');

    const confirming = makePrompter({ showWarningConfirm: async () => true });
    await createDeleteCollectionHandler(store, confirming)({ kind: 'collection', collection });

    const data = store.getAll();
    assert.strictEqual(data.collections.length, 0);
    assert.strictEqual(data.items.find((i) => i.id === item.id)!.collectionId, null);
  });

  test('moveToCollection handler moves the item into the chosen collection', async () => {
    const store = new BookmarkStore(new FakeMemento());
    const collection = await store.addCollection('Work');
    const item = await store.addItem({ type: 'file', uri: 'file:///a.txt' });
    const prompter = makePrompter({ showQuickPick: async () => 'Work' });

    await createMoveToCollectionHandler(store, prompter)({ kind: 'item', item });

    assert.strictEqual(store.getAll().items.find((i) => i.id === item.id)!.collectionId, collection.id);
  });

  test('moveToCollection handler offers "Ungrouped" and moving to it clears collectionId', async () => {
    const store = new BookmarkStore(new FakeMemento());
    const collection = await store.addCollection('Work');
    const item = await store.addItem({ type: 'file', uri: 'file:///a.txt', collectionId: collection.id });
    const prompter = makePrompter({ showQuickPick: async () => 'Ungrouped' });

    await createMoveToCollectionHandler(store, prompter)({ kind: 'item', item });

    assert.strictEqual(store.getAll().items.find((i) => i.id === item.id)!.collectionId, null);
  });

  test('moveToCollection handler does nothing when the pick is cancelled', async () => {
    const store = new BookmarkStore(new FakeMemento());
    const item = await store.addItem({ type: 'file', uri: 'file:///a.txt' });
    await createMoveToCollectionHandler(store, makePrompter())({ kind: 'item', item });
    assert.strictEqual(store.getAll().items.find((i) => i.id === item.id)!.collectionId, null);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL at the `tsc` compile step — `Module '"../../commands"' has no exported member 'Prompter'` (and likewise for `createNewCollectionHandler`, `createRenameCollectionHandler`, `createDeleteCollectionHandler`, `createMoveToCollectionHandler`).

- [ ] **Step 3: Implement collection handlers (add to `src/commands.ts`)**

```ts
export interface Prompter {
  showInputBox(options: vscode.InputBoxOptions): Thenable<string | undefined>;
  showQuickPick(items: string[], options: vscode.QuickPickOptions): Thenable<string | undefined>;
  showWarningConfirm(message: string, confirmLabel: string): Thenable<boolean>;
}

export function createNewCollectionHandler(store: BookmarkStore, prompter: Prompter) {
  return async () => {
    const name = await prompter.showInputBox({ prompt: 'New collection name' });
    if (!name) {
      return;
    }
    await store.addCollection(name);
  };
}

export function createRenameCollectionHandler(store: BookmarkStore, prompter: Prompter) {
  return async (node: BookmarkNode) => {
    if (node.kind !== 'collection') {
      return;
    }
    const name = await prompter.showInputBox({ prompt: 'Rename collection', value: node.collection.name });
    if (!name) {
      return;
    }
    await store.renameCollection(node.collection.id, name);
  };
}

export function createDeleteCollectionHandler(store: BookmarkStore, prompter: Prompter) {
  return async (node: BookmarkNode) => {
    if (node.kind !== 'collection') {
      return;
    }
    const confirmed = await prompter.showWarningConfirm(
      `Delete collection "${node.collection.name}"? Its bookmarks will be ungrouped, not deleted.`,
      'Delete'
    );
    if (!confirmed) {
      return;
    }
    await store.deleteCollection(node.collection.id);
  };
}

export function createMoveToCollectionHandler(store: BookmarkStore, prompter: Prompter) {
  return async (node: BookmarkNode) => {
    if (node.kind !== 'item') {
      return;
    }
    const data = store.getAll();
    const options: { label: string; id: string | null }[] = [
      { label: 'Ungrouped', id: null },
      ...data.collections.map((c) => ({ label: c.name, id: c.id }))
    ];
    const pick = await prompter.showQuickPick(
      options.map((o) => o.label),
      { placeHolder: 'Move bookmark to collection' }
    );
    if (pick === undefined) {
      return;
    }
    const chosen = options.find((o) => o.label === pick);
    if (!chosen) {
      return;
    }
    const siblingCount = data.items.filter((i) => i.collectionId === chosen.id).length;
    await store.moveItem(node.item.id, chosen.id, siblingCount);
  };
}

export function registerCollectionCommands(context: vscode.ExtensionContext, store: BookmarkStore): void {
  const prompter: Prompter = {
    showInputBox: (options) => vscode.window.showInputBox(options),
    showQuickPick: (items, options) => vscode.window.showQuickPick(items, options),
    showWarningConfirm: async (message, confirmLabel) => {
      const result = await vscode.window.showWarningMessage(message, { modal: true }, confirmLabel);
      return result === confirmLabel;
    }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('bookmarks.newCollection', createNewCollectionHandler(store, prompter)),
    vscode.commands.registerCommand('bookmarks.renameCollection', createRenameCollectionHandler(store, prompter)),
    vscode.commands.registerCommand('bookmarks.deleteCollection', createDeleteCollectionHandler(store, prompter)),
    vscode.commands.registerCommand('bookmarks.moveToCollection', createMoveToCollectionHandler(store, prompter))
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: `62 passing`.

- [ ] **Step 5: Commit**

```bash
git add src/commands.ts src/test/suite/commands.test.ts
git commit -m "feat: add collection command handlers (new/rename/delete/moveToCollection)"
```

---

### Task 12: Commands — toggleGroupByRepo / refresh

**Files:**
- Modify: `src/commands.ts`
- Test: `src/test/suite/commands.test.ts`

**Interfaces:**
- Consumes: `BookmarksTreeDataProvider` (Tasks 7-9).
- Produces (used by Task 13): `registerViewCommands(context, provider)`.

- [ ] **Step 1: Write the failing tests (append to `commands.test.ts`)**

```ts
import { BookmarksTreeDataProvider } from '../../bookmarksTreeDataProvider';
import { FsGitCache } from '../../fsGitCache';
import { registerViewCommands } from '../../commands';

suite('commands - view (toggleGroupByRepo / refresh)', () => {
  test('toggleGroupByRepo flips between default and byRepo', async () => {
    const store = new BookmarkStore(new FakeMemento());
    const cache = new FsGitCache(async () => ({ exists: true }));
    const provider = new BookmarksTreeDataProvider(store, cache);
    const subscriptions: vscode.Disposable[] = [];
    registerViewCommands({ subscriptions } as unknown as vscode.ExtensionContext, provider);

    try {
      assert.strictEqual(provider.getGroupMode(), 'default');
      await vscode.commands.executeCommand('bookmarks.toggleGroupByRepo');
      assert.strictEqual(provider.getGroupMode(), 'byRepo');
      await vscode.commands.executeCommand('bookmarks.toggleGroupByRepo');
      assert.strictEqual(provider.getGroupMode(), 'default');
    } finally {
      subscriptions.forEach((d) => d.dispose());
    }
  });

  test('refresh invalidates the cache so the next render re-resolves', async () => {
    let resolveCalls = 0;
    const store = new BookmarkStore(new FakeMemento());
    const cache = new FsGitCache(async () => { resolveCalls++; return { exists: true }; });
    const provider = new BookmarksTreeDataProvider(store, cache);
    const subscriptions: vscode.Disposable[] = [];
    registerViewCommands({ subscriptions } as unknown as vscode.ExtensionContext, provider);

    try {
      const item = await store.addItem({ type: 'file', uri: 'file:///a.txt' });
      await provider.getTreeItem({ kind: 'item', item });
      assert.strictEqual(resolveCalls, 1);

      await vscode.commands.executeCommand('bookmarks.refresh');
      await provider.getTreeItem({ kind: 'item', item });
      assert.strictEqual(resolveCalls, 2);
    } finally {
      subscriptions.forEach((d) => d.dispose());
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL at the `tsc` compile step — `Module '"../../commands"' has no exported member 'registerViewCommands'`.

- [ ] **Step 3: Implement (add to `src/commands.ts`)**

```ts
import { BookmarksTreeDataProvider } from './bookmarksTreeDataProvider';

export function registerViewCommands(context: vscode.ExtensionContext, provider: BookmarksTreeDataProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('bookmarks.toggleGroupByRepo', () => {
      provider.setGroupMode(provider.getGroupMode() === 'default' ? 'byRepo' : 'default');
    }),
    vscode.commands.registerCommand('bookmarks.refresh', () => {
      provider.refresh();
    })
  );
}
```

(Add the `import { BookmarksTreeDataProvider } from './bookmarksTreeDataProvider';` line alongside `commands.ts`'s existing imports at the top of the file, not inline.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: `64 passing`.

- [ ] **Step 5: Commit**

```bash
git add src/commands.ts src/test/suite/commands.test.ts
git commit -m "feat: add toggleGroupByRepo and refresh command handlers"
```

---

### Task 13: extension.ts activation wiring

**Files:**
- Modify: `src/extension.ts`
- Test: `src/test/suite/extension.test.ts`

**Interfaces:**
- Consumes: every module produced by Tasks 2-12.
- Produces: a fully wired `activate()` — the extension is now feature-complete and runnable via F5.

- [ ] **Step 1: Write the failing test (append to `extension.test.ts`)**

```ts
test('activation registers every bookmarks.* command', async () => {
  const ext = vscode.extensions.getExtension('cbeaulieu-gt.vscode-bookmarks-plus')!;
  await ext.activate();

  const commands = await vscode.commands.getCommands(true);
  const expected = [
    'bookmarks.addFile',
    'bookmarks.addFolder',
    'bookmarks.remove',
    'bookmarks.reveal',
    'bookmarks.newCollection',
    'bookmarks.renameCollection',
    'bookmarks.deleteCollection',
    'bookmarks.moveToCollection',
    'bookmarks.toggleGroupByRepo',
    'bookmarks.refresh'
  ];

  for (const command of expected) {
    assert.ok(commands.includes(command), `expected command "${command}" to be registered`);
  }
});
```

- [ ] **Step 2: Run the tests to verify it fails**

Run: `npm test`
Expected: FAIL — most `bookmarks.*` commands are missing (`activate()` is still the Task 1 stub).

- [ ] **Step 3: Write the full activation wiring — `src/extension.ts`**

```ts
import * as vscode from 'vscode';
import * as fsPromises from 'fs/promises';
import { BookmarkStore } from './bookmarkStore';
import { FsGitCache } from './fsGitCache';
import { createGitApiFactory, findRepoNameForUri, GitExtensionExports } from './gitInfo';
import { BookmarksTreeDataProvider } from './bookmarksTreeDataProvider';
import {
  registerAddCommands,
  registerItemCommands,
  registerCollectionCommands,
  registerViewCommands
} from './commands';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Bookmarks Plus');
  const store = new BookmarkStore(context.workspaceState, output);

  let onGitReady: () => void = () => {};
  const gitApiFactory = createGitApiFactory(
    () => vscode.extensions.getExtension<GitExtensionExports>('vscode.git'),
    () => onGitReady()
  );

  const cache = new FsGitCache(async (uriString) => {
    const uri = vscode.Uri.parse(uriString);
    let exists = true;
    try {
      await fsPromises.stat(uri.fsPath);
    } catch {
      exists = false;
    }
    const api = await gitApiFactory();
    const repoName = api ? findRepoNameForUri(api, uri) : undefined;
    return { exists, repoName };
  });

  const provider = new BookmarksTreeDataProvider(store, cache);
  // Design note (see top-level "spec ambiguities" §2): §4 says the extension "fires
  // onBookmarksChanged once" when the git API first becomes ready, but BookmarkStore's
  // public surface (§2) has no force-fire method. provider.refresh() produces the
  // identical externally observable effect — one cache invalidation, one redraw —
  // via the same path already specified for the manual bookmarks.refresh command.
  onGitReady = () => provider.refresh();

  const view = vscode.window.createTreeView('bookmarksView', {
    treeDataProvider: provider,
    dragAndDropController: provider,
    showCollapseAll: true
  });

  context.subscriptions.push(view, output);

  registerAddCommands(context, store);
  registerItemCommands(context, store);
  registerCollectionCommands(context, store);
  registerViewCommands(context, provider);

  // Kick off vscode.git activation + readiness race handling immediately (spec §4) —
  // no polling, and createGitApiFactory guarantees at most one forced re-render per activation.
  void gitApiFactory();
}

export function deactivate(): void {}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: `65 passing`.

- [ ] **Step 5: Commit**

```bash
git add src/extension.ts src/test/suite/extension.test.ts
git commit -m "feat: wire BookmarkStore, tree provider, and all commands in extension activation"
```

---

### Task 14: Packaging and publishing

**Files:**
- Create: `images/icon.png`
- Create: `CHANGELOG.md`
- Create: `LICENSE`
- Modify: `README.md`
- Modify: `package.json` (bump version if needed after the above)

Per §8, this is real, actionable work — no `TBD` steps.

- [ ] **Step 1: Create the 128x128 icon**

Design or source a 128x128 PNG icon and save it to `images/icon.png` (already referenced by `package.json`'s `"icon"` field from Task 1). Any raster tool works (Figma export, `npx` icon generator, hand-drawn PNG) — the only hard requirement is the exact pixel dimensions.

- [ ] **Step 2: Verify the icon's dimensions**

Run:
```bash
node -e "
const fs = require('fs');
const buf = fs.readFileSync('images/icon.png');
const width = buf.readUInt32BE(16);
const height = buf.readUInt32BE(20);
console.log(width, height);
if (width !== 128 || height !== 128) {
  console.error('icon.png must be exactly 128x128, got ' + width + 'x' + height);
  process.exit(1);
}
"
```
Expected: prints `128 128`, exits 0.

- [ ] **Step 3: Write `CHANGELOG.md`**

```markdown
# Changelog

All notable changes to the "Bookmarks Plus" extension are documented in this file.

## [0.1.0] - Unreleased

### Added
- Bookmark files and folders (not just lines) per workspace, for single-root and multi-root workspaces.
- Collections: group bookmarks, rename and delete collections (deleting ungroups rather than deletes items).
- Drag-and-drop reordering and cross-collection moves.
- Group-by-repo view, with an "Unknown" bucket for items with no resolvable repo.
- Broken-bookmark detection (missing path) with a warning icon; no auto-fix, remove manually.
- Repo-name badges resolved live via the built-in `vscode.git` extension (soft dependency — omitted silently if unavailable).
```

- [ ] **Step 4: Write `LICENSE`** (MIT)

```
MIT License

Copyright (c) 2026 the vscode-bookmarks-plus contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 5: Capture a screenshot and update `README.md`**

Press F5 (or use the "Run Extension" launch config from Task 1) to open an Extension Development Host, add a few file/folder bookmarks and a collection, then capture a screenshot and save it to `images/screenshot.png`. Update `README.md`:

```markdown

## Features

- Bookmark whole files and folders — not just lines — per workspace.
- Organize bookmarks into collections; drag and drop to reorder or move between collections.
- Group the view by git repository, with a dedicated "Unknown" group for anything unresolved.
- Broken bookmarks (moved/deleted targets) show a warning icon instead of erroring.

![Bookmarks Plus screenshot](images/screenshot.png)

## Requirements

None beyond VS Code itself. The repo-name badge uses the built-in `vscode.git` extension when it's enabled; the extension works without it, just without badges.
```

- [ ] **Step 6: Register the publisher and package the extension**

```bash
npx @vscode/vsce login cbeaulieu-gt
```
(One-time: requires a Visual Studio Marketplace personal access token for the `cbeaulieu-gt` publisher, created at https://dev.azure.com under Personal Access Tokens with Marketplace "Manage" scope. If `cbeaulieu-gt` is not yet a registered Marketplace publisher, create it first at https://marketplace.visualstudio.com/manage before running `vsce login`.)

```bash
npx @vscode/vsce package
```
Expected: produces `vscode-bookmarks-plus-0.1.0.vsix` in the repo root, with no packaging errors (missing `LICENSE`/`icon.png`/repository field would fail this step — all are already in place from Steps 1-4).

- [ ] **Step 7: Publish (run manually, once ready — not part of automated task execution)**

```bash
npx @vscode/vsce publish
```

- [ ] **Step 8: Commit**

```bash
git add images/icon.png images/screenshot.png CHANGELOG.md LICENSE README.md
git commit -m "chore: add packaging assets (icon, screenshot, changelog, license) and publish instructions"
```

---

## Self-Review

**1. Spec coverage** — every spec section maps to at least one task:
- §1 (scoping, tech stack) → Task 1.
- §2 (architecture, event ownership, mutation path, in-memory cache) → Tasks 2-9, 13.
- §3 (data model, ordering/renumbering, atomic collection delete, malformed-data recovery, no cross-window conflict detection, git info not stored) → Tasks 2-4, 6.
- §4 (UI, git activation race, broken-bookmark rendering, view-title buttons, DnD disabled in group-by-repo, Unknown bucket, context menus, empty state) → Tasks 1, 6-9, 13.
- §5 (commands table, palette scope cut, folder click behavior, click behavior, no custom labels, no auto-follow) → Tasks 1, 7, 10-13.
- §6 (all four error-handling cases: broken path, git unavailable, empty state, corrupt data) → Tasks 2 (corrupt data), 7 (broken path, empty state), 6/13 (git unavailable).
- §7 (testing — every named test explicitly written): multi-root URI resolution (Task 2), DnD reorder within a parent (Task 3, Task 9), DnD move across collections (Task 3, Task 9), collection deletion semantics incl. single-write atomicity (Task 4), tree renders from fixtures (Task 7-8), group-by-repo Unknown bucket (Task 8), single re-render on git-API-ready (Task 6), grouped-by-repo with no active repo (Task 8), broken-path rendering (Task 7), click/reveal behavior (Task 7, Task 10).
- §8 (packaging: publisher, icon, README+screenshot, CHANGELOG, LICENSE, semver) → Task 14. CI is explicitly excluded per the task brief (tracked in issue #3).

**2. Placeholder scan** — no `TBD`/`TODO`/"add appropriate handling"/"similar to Task N" strings appear; every code step shows complete, real code; Task 14's external steps (icon creation, screenshot, publisher registration) are the only steps that require a human/runtime action, and each has a concrete verification command or explicit manual instruction rather than a vague placeholder.

**3. Type consistency** — checked across all 14 tasks: `BookmarkItem`/`BookmarkCollection`/`BookmarkData` (Task 2) are used identically everywhere downstream; `BookmarkStore` method names (`addItem`, `removeItem`, `moveItem`, `addCollection`, `renameCollection`, `deleteCollection`, `getAll`, `onBookmarksChanged`) match the spec's §2 list exactly and are used with the same signatures in Tasks 7-13; `BookmarkNode`'s three variants (`collection` with optional `repoLabel`, `item`, `repoGroup`) are introduced in Task 7 and used with the same shape in Tasks 8-13; `CacheEntry { exists; repoName? }` (Task 5) matches its usage in Tasks 6-9 and 13; `Prompter`'s three methods (Task 11) match their fake implementations in the Task 11 tests and their real implementation in `registerCollectionCommands`; `DND_MIME_TYPE` (Task 7) is the same string constant used in Task 9's `dropMimeTypes`/`dragMimeTypes` and its tests.
