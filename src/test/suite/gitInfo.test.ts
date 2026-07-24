import * as assert from 'assert';
import * as vscode from 'vscode';
import { createGitApiFactory, findRepoNameForUri, GitApi, GitExtensionExports } from '../../gitInfo';

function makeFakeGitExtension(initialState: 'uninitialized' | 'initialized') {
  const emitter = new vscode.EventEmitter<'uninitialized' | 'initialized'>();
  let state: 'uninitialized' | 'initialized' = initialState;
  const api: GitApi = {
    get state() { return state; },
    onDidChangeState: emitter.event,
    repositories: []
  };
  const extension = {
    id: 'vscode.git',
    isActive: true,
    exports: { getAPI: (_v: 1) => api } as GitExtensionExports,
    activate: async () => extension.exports
  } as unknown as vscode.Extension<GitExtensionExports>;

  return {
    extension,
    setState(next: 'uninitialized' | 'initialized') {
      state = next;
      emitter.fire(next);
    }
  };
}

suite('gitInfo.createGitApiFactory', () => {
  test('returns undefined when vscode.git is not installed (soft dependency)', async () => {
    const factory = createGitApiFactory(
      () => undefined,
      () => { throw new Error('onFirstReady must not fire when the extension is missing'); }
    );
    const api = await factory();
    assert.strictEqual(api, undefined);
  });

  test('resolves immediately and fires onFirstReady exactly once when already initialized', async () => {
    const { extension } = makeFakeGitExtension('initialized');
    let readyCount = 0;
    const factory = createGitApiFactory(() => extension, () => { readyCount++; });

    const first = await factory();
    assert.ok(first);
    assert.strictEqual(readyCount, 1);

    const second = await factory();
    assert.ok(second);
    assert.strictEqual(readyCount, 1, 'onFirstReady must never fire a second time');
  });

  test('waits for onDidChangeState and fires onFirstReady exactly once on the first transition to initialized', async () => {
    const { extension, setState } = makeFakeGitExtension('uninitialized');
    let readyCount = 0;
    const factory = createGitApiFactory(() => extension, () => { readyCount++; });

    const pending = factory();
    setState('initialized');
    const api = await pending;

    assert.ok(api);
    assert.strictEqual(readyCount, 1);
  });
});

suite('gitInfo.findRepoNameForUri', () => {
  test('returns the basename of the longest matching repository root', () => {
    const api: GitApi = {
      state: 'initialized',
      onDidChangeState: new vscode.EventEmitter<'uninitialized' | 'initialized'>().event,
      repositories: [
        { rootUri: vscode.Uri.file('/workspace/repo-a') },
        { rootUri: vscode.Uri.file('/workspace/repo-a/nested-repo') }
      ]
    };

    const name = findRepoNameForUri(api, vscode.Uri.file('/workspace/repo-a/nested-repo/src/file.ts'));
    assert.strictEqual(name, 'nested-repo');
  });

  test('returns undefined when no repository contains the uri', () => {
    const api: GitApi = {
      state: 'initialized',
      onDidChangeState: new vscode.EventEmitter<'uninitialized' | 'initialized'>().event,
      repositories: [{ rootUri: vscode.Uri.file('/workspace/repo-a') }]
    };

    const name = findRepoNameForUri(api, vscode.Uri.file('/elsewhere/file.ts'));
    assert.strictEqual(name, undefined);
  });
});
