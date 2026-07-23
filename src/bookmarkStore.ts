import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import {
  BookmarkCollection,
  BookmarkData,
  BookmarkItem,
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
}
