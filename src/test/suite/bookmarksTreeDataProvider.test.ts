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
