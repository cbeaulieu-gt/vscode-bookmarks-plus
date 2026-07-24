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

    const nonItemNode: BookmarkNode = { kind: 'repoGroup', label: 'x', repoKey: 'x' };
    await handler(nonItemNode);
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
    const nonItemNode: BookmarkNode = { kind: 'repoGroup', label: 'x', repoKey: 'x' };
    await handler(nonItemNode);
    assert.strictEqual(called, false);
  });
});
