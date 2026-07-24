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
}
