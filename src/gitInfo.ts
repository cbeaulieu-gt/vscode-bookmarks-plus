import * as vscode from 'vscode';
import * as path from 'path';

/** Minimal shim for the subset of the built-in vscode.git extension's API this extension consumes. */
export interface GitRepository {
  rootUri: vscode.Uri;
}

export interface GitApi {
  state: 'uninitialized' | 'initialized';
  onDidChangeState: vscode.Event<'uninitialized' | 'initialized'>;
  repositories: GitRepository[];
}

export interface GitExtensionExports {
  getAPI(version: 1): GitApi;
}

export type GitApiFactory = () => Promise<GitApi | undefined>;

/**
 * Activates the built-in vscode.git extension (if present) and resolves once its API
 * reports state === 'initialized'. Calls onFirstReady exactly once, the first time that
 * happens. Returns undefined -- without ever calling onFirstReady -- if the extension is
 * missing (the soft-dependency case from spec section 3/4/6).
 */
export function createGitApiFactory(
  lookupGitExtension: () => vscode.Extension<GitExtensionExports> | undefined,
  onFirstReady: () => void
): GitApiFactory {
  let cachedApi: GitApi | undefined;
  let readyFired = false;

  const markReady = () => {
    if (!readyFired) {
      readyFired = true;
      onFirstReady();
    }
  };

  return async function getGitApi(): Promise<GitApi | undefined> {
    if (cachedApi && cachedApi.state === 'initialized') {
      return cachedApi;
    }

    const ext = lookupGitExtension();
    if (!ext) {
      return undefined;
    }

    const exports = ext.isActive ? ext.exports : await ext.activate();
    const api = exports.getAPI(1);
    cachedApi = api;

    if (api.state === 'initialized') {
      markReady();
      return api;
    }

    return new Promise((resolve) => {
      const subscription = api.onDidChangeState((state) => {
        if (state === 'initialized') {
          subscription.dispose();
          markReady();
          resolve(api);
        }
      });
    });
  };
}

/** Finds the repository (if any) whose root contains uri, preferring the deepest (longest) match. */
export function findRepoNameForUri(api: GitApi, uri: vscode.Uri): string | undefined {
  let best: GitRepository | undefined;
  for (const repo of api.repositories) {
    const rootPath = repo.rootUri.fsPath;
    const isMatch = uri.fsPath === rootPath || uri.fsPath.startsWith(rootPath + path.sep);
    if (isMatch && (!best || rootPath.length > best.rootUri.fsPath.length)) {
      best = repo;
    }
  }
  return best ? path.basename(best.rootUri.fsPath) : undefined;
}
