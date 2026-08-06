import * as assert from 'assert';
import { normalizeBookmarkData } from '../../normalize';
import { BookmarkData } from '../../types';

function data(partial: Partial<BookmarkData>): BookmarkData {
  return { version: 2, items: [], collections: [], ...partial };
}

suite('normalizeBookmarkData', () => {
  test('leaves already-valid data untouched and reports changed === false', () => {
    const input = data({
      items: [
        { id: 'i1', type: 'file', uri: 'file:///a.txt', collectionId: null, order: 0 },
        { id: 'i2', type: 'file', uri: 'file:///b.txt', collectionId: 'c1', order: 0 }
      ],
      collections: [{ id: 'c1', name: 'Work', order: 0 }]
    });

    const result = normalizeBookmarkData(input);

    assert.strictEqual(result.changed, false);
    assert.deepStrictEqual(result.data, input);
    assert.deepStrictEqual(result.notes, []);
  });

  test('does not mutate its input', () => {
    const input = data({ items: [{ id: 'i1', type: 'file', uri: 'file:///a.txt', collectionId: 'ghost', order: 7 }] });
    const snapshot = JSON.stringify(input);
    normalizeBookmarkData(input);
    assert.strictEqual(JSON.stringify(input), snapshot);
  });

  test('ungroups an item whose collectionId does not exist', () => {
    const result = normalizeBookmarkData(
      data({ items: [{ id: 'i1', type: 'file', uri: 'file:///a.txt', collectionId: 'ghost', order: 0 }] })
    );
    assert.strictEqual(result.data.items[0].collectionId, null);
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.notes.length, 1);
  });

  test('drops duplicate (uri, collectionId) pairs, keeping the lowest-ordered one', () => {
    const result = normalizeBookmarkData(
      data({
        items: [
          { id: 'keep', type: 'file', uri: 'file:///a.txt', collectionId: null, order: 0 },
          { id: 'drop', type: 'file', uri: 'file:///a.txt', collectionId: null, order: 1 }
        ]
      })
    );
    assert.deepStrictEqual(result.data.items.map((i) => i.id), ['keep']);
    assert.strictEqual(result.changed, true);
  });

  test('keeps the same uri in two different collections', () => {
    const result = normalizeBookmarkData(
      data({
        items: [
          { id: 'i1', type: 'file', uri: 'file:///a.txt', collectionId: null, order: 0 },
          { id: 'i2', type: 'file', uri: 'file:///a.txt', collectionId: 'c1', order: 0 }
        ],
        collections: [{ id: 'c1', name: 'Work', order: 0 }]
      })
    );
    assert.strictEqual(result.data.items.length, 2);
    assert.strictEqual(result.changed, false);
  });

  test('renumbers gapped and duplicated orders contiguously per parent, preserving relative order', () => {
    const result = normalizeBookmarkData(
      data({
        items: [
          { id: 'i1', type: 'file', uri: 'file:///a.txt', collectionId: null, order: 5 },
          { id: 'i2', type: 'file', uri: 'file:///b.txt', collectionId: null, order: 5 },
          { id: 'i3', type: 'file', uri: 'file:///c.txt', collectionId: null, order: 9 }
        ]
      })
    );
    assert.deepStrictEqual(result.data.items.map((i) => [i.id, i.order]), [['i1', 0], ['i2', 1], ['i3', 2]]);
    assert.strictEqual(result.changed, true);
  });

  test('renumbers collections contiguously', () => {
    const result = normalizeBookmarkData(
      data({ collections: [{ id: 'c1', name: 'A', order: 3 }, { id: 'c2', name: 'B', order: 8 }] })
    );
    assert.deepStrictEqual(result.data.collections.map((c) => c.order), [0, 1]);
    assert.strictEqual(result.changed, true);
  });

  test('trims descriptions and removes empty ones', () => {
    const result = normalizeBookmarkData(
      data({
        items: [{ id: 'i1', type: 'file', uri: 'file:///a.txt', collectionId: null, order: 0, description: '  note  ' }],
        collections: [{ id: 'c1', name: 'Work', order: 0, description: '   ' }]
      })
    );
    assert.strictEqual(result.data.items[0].description, 'note');
    assert.strictEqual('description' in result.data.collections[0], false, 'an empty description must be removed, not stored as ""');
    assert.strictEqual(result.changed, true);
  });

  test('stamps the current schema version on its output', () => {
    const result = normalizeBookmarkData(data({}));
    assert.strictEqual(result.data.version, 2);
  });
});
