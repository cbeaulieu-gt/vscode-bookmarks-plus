import * as assert from 'assert';
import { migrateBookmarkData, UnsupportedSchemaVersionError } from '../../migrations';
import { BookmarkData, CURRENT_SCHEMA_VERSION } from '../../types';
import { isStrictBookmarkData, isValidBookmarkItem, normalizeDescription } from '../../types';

const v1Fixture = {
  version: 1,
  items: [
    { id: 'i1', type: 'file', uri: 'file:///a.txt', collectionId: null, order: 0 },
    { id: 'i2', type: 'folder', uri: 'file:///dir', collectionId: 'c1', order: 0 }
  ],
  collections: [{ id: 'c1', name: 'Work', order: 0 }]
} as unknown as BookmarkData;

suite('migrations.migrateBookmarkData', () => {
  test('CURRENT_SCHEMA_VERSION is 2', () => {
    assert.strictEqual(CURRENT_SCHEMA_VERSION, 2);
  });

  test('migrates v1 data to v2, leaving every description undefined', () => {
    const migrated = migrateBookmarkData(v1Fixture);
    assert.strictEqual(migrated.version, 2);
    assert.strictEqual(migrated.items.length, 2);
    assert.strictEqual(migrated.collections.length, 1);
    assert.strictEqual(migrated.items[0].description, undefined);
    assert.strictEqual(migrated.items[1].description, undefined);
    assert.strictEqual(migrated.collections[0].description, undefined);
  });

  test('migrating v1 preserves every existing field verbatim', () => {
    const migrated = migrateBookmarkData(v1Fixture);
    assert.deepStrictEqual(migrated.items[1], {
      id: 'i2', type: 'folder', uri: 'file:///dir', collectionId: 'c1', order: 0
    });
  });

  test('does not mutate its input', () => {
    const input = JSON.parse(JSON.stringify(v1Fixture)) as BookmarkData;
    const snapshot = JSON.stringify(input);
    migrateBookmarkData(input);
    assert.strictEqual(JSON.stringify(input), snapshot, 'input must be treated as immutable');
  });

  test('passes v2 data through unchanged', () => {
    const v2: BookmarkData = {
      version: 2,
      items: [{ id: 'i1', type: 'file', uri: 'file:///a.txt', collectionId: null, order: 0, description: 'note' }],
      collections: []
    };
    const migrated = migrateBookmarkData(v2);
    assert.deepStrictEqual(migrated, v2);
  });

  test('refuses to migrate a future schema version', () => {
    const future = { version: 3, items: [], collections: [] } as BookmarkData;
    assert.throws(() => migrateBookmarkData(future), UnsupportedSchemaVersionError);
  });

  test('refuses a version with no registered migration path', () => {
    const ancient = { version: 0, items: [], collections: [] } as BookmarkData;
    assert.throws(() => migrateBookmarkData(ancient), UnsupportedSchemaVersionError);
  });
});

suite('types - strict validation', () => {
  const validItem = { id: 'i1', type: 'file', uri: 'file:///a.txt', collectionId: null, order: 0 };

  test('accepts a well-formed item, with and without a description', () => {
    assert.strictEqual(isValidBookmarkItem(validItem), true);
    assert.strictEqual(isValidBookmarkItem({ ...validItem, description: 'note' }), true);
  });

  test('rejects an item missing an id', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, ...withoutId } = validItem;
    assert.strictEqual(isValidBookmarkItem(withoutId), false);
  });

  test('rejects an item with an unknown type', () => {
    assert.strictEqual(isValidBookmarkItem({ ...validItem, type: 'symlink' }), false);
  });

  test('rejects a non-string description', () => {
    assert.strictEqual(isValidBookmarkItem({ ...validItem, description: 42 }), false);
  });

  test('rejects a non-numeric order', () => {
    assert.strictEqual(isValidBookmarkItem({ ...validItem, order: '0' }), false);
  });

  test('isStrictBookmarkData rejects a payload whose items array holds one bad entry', () => {
    const data = { version: 2, items: [validItem, { nope: true }], collections: [] };
    assert.strictEqual(isStrictBookmarkData(data), false);
  });

  test('isStrictBookmarkData accepts a fully valid payload', () => {
    assert.strictEqual(
      isStrictBookmarkData({ version: 2, items: [validItem], collections: [{ id: 'c1', name: 'Work', order: 0 }] }),
      true
    );
  });

  test('normalizeDescription trims, and maps empty/whitespace to undefined', () => {
    assert.strictEqual(normalizeDescription('  hello  '), 'hello');
    assert.strictEqual(normalizeDescription(''), undefined);
    assert.strictEqual(normalizeDescription('   '), undefined);
    assert.strictEqual(normalizeDescription(undefined), undefined);
  });
});
