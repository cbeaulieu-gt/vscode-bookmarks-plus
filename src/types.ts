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
