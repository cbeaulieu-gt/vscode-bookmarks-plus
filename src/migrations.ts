import { BookmarkData, CURRENT_SCHEMA_VERSION } from './types';

export class UnsupportedSchemaVersionError extends Error {
  constructor(readonly version: number) {
    super(`Unsupported bookmarks schema version: ${version}`);
    this.name = 'UnsupportedSchemaVersionError';
  }
}

type MigrationInput = Record<string, unknown>;

/**
 * Version-keyed migration ladder, applied in ascending order: the handler under key N
 * transforms vN data into v(N+1) data. Each handler is pure — it returns new data and
 * never mutates its input.
 *
 * Pattern (not code) borrowed from `conf` and `redux-persist`, which converged on the
 * same shape independently; neither is taken as a dependency (see the plan's Tech Stack
 * note and issue #51's research findings).
 */
const migrations: Record<number, (data: MigrationInput) => MigrationInput> = {
  // v1 -> v2: `description` is a new optional field on items and collections.
  // Nothing to backfill — absent means "no description".
  1: (data) => ({ ...data, version: 2 })
};

/**
 * Migrates data up to CURRENT_SCHEMA_VERSION. Throws UnsupportedSchemaVersionError when
 * the data is newer than this extension understands (a file written by a newer version,
 * which must never be silently rewritten) or when the ladder has no rung for its version.
 */
export function migrateBookmarkData(input: BookmarkData): BookmarkData {
  if (input.version > CURRENT_SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(input.version);
  }
  let current = JSON.parse(JSON.stringify(input)) as MigrationInput;
  for (let version = input.version; version < CURRENT_SCHEMA_VERSION; version++) {
    const migration = migrations[version];
    if (!migration) {
      throw new UnsupportedSchemaVersionError(version);
    }
    current = migration(current);
  }
  return current as unknown as BookmarkData;
}
