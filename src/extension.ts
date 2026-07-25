import * as fs from 'fs';
import * as vscode from 'vscode';
import { BookmarkStore } from './bookmarkStore';
import { BookmarksTreeDataProvider } from './bookmarksTreeDataProvider';
import {
  registerAddCommands,
  registerCollectionCommands,
  registerItemCommands,
  registerViewCommands
} from './commands';
import { CacheEntry, FsGitCache, ResolveFn } from './fsGitCache';
import {
  createGitApiFactory,
  findRepoNameForUri,
  GitApiFactory,
  GitExtensionExports
} from './gitInfo';

function createCacheResolver(getGitApi: GitApiFactory): ResolveFn {
  return async (uriString: string): Promise<CacheEntry> => {
    const uri = vscode.Uri.parse(uriString);
    let exists = true;

    try {
      await fs.promises.stat(uri.fsPath);
    } catch {
      exists = false;
    }

    const api = await getGitApi();
    const repoName = api ? findRepoNameForUri(api, uri) : undefined;
    return { exists, repoName };
  };
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Bookmarks Plus');
  const store = new BookmarkStore(context.workspaceState, output);

  let provider: BookmarksTreeDataProvider | undefined = undefined;
  const getGitApi = createGitApiFactory(
    () => vscode.extensions.getExtension<GitExtensionExports>('vscode.git'),
    () => provider?.refresh()
  );
  const cache = new FsGitCache(createCacheResolver(getGitApi));
  provider = new BookmarksTreeDataProvider(store, cache);

  const treeView = vscode.window.createTreeView('bookmarksView', {
    treeDataProvider: provider,
    dragAndDropController: provider,
    showCollapseAll: true
  });
  context.subscriptions.push(output, treeView);

  registerAddCommands(context, store);
  registerItemCommands(context, store);
  registerCollectionCommands(context, store);
  registerViewCommands(context, provider);

  void getGitApi().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine(`Git integration unavailable: ${message}`);
  });
}

export function deactivate(): void {}
