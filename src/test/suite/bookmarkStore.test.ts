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
