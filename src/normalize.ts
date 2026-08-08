import { randomUUID } from 'crypto';
import {
  BookmarkCollection,
  BookmarkData,
  BookmarkItem,
  CURRENT_SCHEMA_VERSION,
  normalizeDescription
} from './types';

export interface NormalizeResult {
  data: BookmarkData;
  /** True when normalization had to change something — the caller should write the repaired data back. */
  changed: boolean;
  /** Human-readable notes for the output channel, one per class of repair. */
  notes: string[];
}

function withDescription<T extends { description?: string }>(entry: T): { entry: T; changed: boolean } {
  const normalized = normalizeDescription(entry.description);
  if (normalized === entry.description) {
    return { entry, changed: false };
  }
  const next = { ...entry };
  if (normalized === undefined) {
    delete next.description;
  } else {
    next.description = normalized;
  }
  return { entry: next, changed: true };
}

/**
 * Repairs data authored outside the extension so it satisfies BookmarkStore's invariants:
 * every collectionId resolves, no duplicate (uri, collectionId) pair, contiguous zero-based
 * ordering per parent, and normalized descriptions. Pure — never mutates its input.
 */
export function normalizeBookmarkData(input: BookmarkData): NormalizeResult {
  const notes: string[] = [];
  let changed = false;

  const uniqueId = (seenIds: Set<string>): string => {
    let id: string;
    do {
      id = randomUUID();
    } while (seenIds.has(id));
    return id;
  };

  const seenItemIds = new Set<string>();
  const itemsWithUniqueIds = input.items.map((item) => {
    if (!seenItemIds.has(item.id)) {
      seenItemIds.add(item.id);
      return item;
    }
    const id = uniqueId(seenItemIds);
    seenItemIds.add(id);
    changed = true;
    notes.push(`duplicate id "${item.id}" was reassigned a new id.`);
    return { ...item, id };
  });

  const seenCollectionIds = new Set<string>();
  const collectionsWithUniqueIds = input.collections.map((collection) => {
    if (!seenCollectionIds.has(collection.id)) {
      seenCollectionIds.add(collection.id);
      return collection;
    }
    const id = uniqueId(seenCollectionIds);
    seenCollectionIds.add(id);
    changed = true;
    notes.push(`duplicate id "${collection.id}" was reassigned a new id.`);
    return { ...collection, id };
  });

  const knownCollectionIds = new Set(collectionsWithUniqueIds.map((c) => c.id));

  // 1. Descriptions + dangling collection references.
  let items: BookmarkItem[] = itemsWithUniqueIds.map((item) => {
    const normalized = withDescription(item);
    let next = normalized.entry;
    if (normalized.changed) {
      changed = true;
    }
    if (next.collectionId !== null && !knownCollectionIds.has(next.collectionId)) {
      next = { ...next, collectionId: null };
      changed = true;
      notes.push(`bookmark "${next.uri}" referenced an unknown collection and was ungrouped.`);
    }
    return next;
  });

  // 2. Duplicate (uri, collectionId) pairs — keep the first in sorted order.
  const seen = new Set<string>();
  const deduped: BookmarkItem[] = [];
  for (const item of [...items].sort((a, b) => a.order - b.order)) {
    const key = `${item.collectionId ?? ''} ${item.uri}`;
    if (seen.has(key)) {
      changed = true;
      notes.push(`duplicate bookmark "${item.uri}" was dropped.`);
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  items = deduped;

  // 3. Contiguous zero-based ordering per parent, preserving relative order.
  const parents = new Map<string, BookmarkItem[]>();
  for (const item of items) {
    const key = item.collectionId ?? '';
    const siblings = parents.get(key) ?? [];
    siblings.push(item);
    parents.set(key, siblings);
  }
  const renumbered = new Map<string, number>();
  for (const siblings of parents.values()) {
    siblings
      .sort((a, b) => a.order - b.order)
      .forEach((item, index) => {
        renumbered.set(item.id, index);
        if (item.order !== index) {
          changed = true;
        }
      });
  }
  items = items.map((item) => ({ ...item, order: renumbered.get(item.id)! }));

  // 4. Collections: descriptions + contiguous ordering.
  const sortedCollections = [...collectionsWithUniqueIds].sort((a, b) => a.order - b.order);
  const collections: BookmarkCollection[] = sortedCollections.map((collection, index) => {
    const normalized = withDescription(collection);
    if (normalized.changed) {
      changed = true;
    }
    if (normalized.entry.order !== index) {
      changed = true;
      return { ...normalized.entry, order: index };
    }
    return normalized.entry;
  });

  if (changed && notes.length === 0) {
    notes.push('bookmark ordering or descriptions were normalized.');
  }

  return {
    data: { version: CURRENT_SCHEMA_VERSION, items, collections },
    changed,
    notes
  };
}
