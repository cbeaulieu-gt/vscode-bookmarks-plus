import * as vscode from 'vscode';
import { BookmarkStore } from './bookmarkStore';
import { BookmarkNode } from './bookmarksTreeDataProvider';

export function createAddFileHandler(
  store: BookmarkStore
): (uri: vscode.Uri) => Promise<void> {
  return async (uri: vscode.Uri): Promise<void> => {
    await store.addItem({ type: 'file', uri: uri.toString() });
  };
}

export function createAddFolderHandler(
  store: BookmarkStore
): (uri: vscode.Uri) => Promise<void> {
  return async (uri: vscode.Uri): Promise<void> => {
    await store.addItem({ type: 'folder', uri: uri.toString() });
  };
}

export function createRemoveHandler(
  store: BookmarkStore
): (node: BookmarkNode) => Promise<void> {
  return async (node: BookmarkNode): Promise<void> => {
    if (node.kind !== 'item') {
      return;
    }
    await store.removeItem(node.item.id);
  };
}

export function createRevealHandler(
  reveal: (uri: vscode.Uri) => Thenable<unknown>
): (node: BookmarkNode) => Promise<void> {
  return async (node: BookmarkNode): Promise<void> => {
    if (node.kind !== 'item') {
      return;
    }
    await reveal(vscode.Uri.parse(node.item.uri));
  };
}

export function registerAddCommands(
  context: vscode.ExtensionContext,
  store: BookmarkStore
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('bookmarks.addFile', createAddFileHandler(store)),
    vscode.commands.registerCommand('bookmarks.addFolder', createAddFolderHandler(store))
  );
}

export function registerItemCommands(
  context: vscode.ExtensionContext,
  store: BookmarkStore
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('bookmarks.remove', createRemoveHandler(store)),
    vscode.commands.registerCommand(
      'bookmarks.reveal',
      createRevealHandler((uri) =>
        vscode.commands.executeCommand('revealInExplorer', uri)
      )
    )
  );
}
