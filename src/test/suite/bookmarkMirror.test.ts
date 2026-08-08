import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import {
  MIRROR_RELATIVE_PATH,
  WorkspaceMirrorFile,
  hashContent,
  resolveMirrorLocation,
  serializeBookmarkData
} from '../../bookmarkMirror';
import { BookmarkData } from '../../types';

const sampleData: BookmarkData = {
  version: 2,
  items: [{ id: 'i1', type: 'file', uri: 'file:///a.txt', collectionId: null, order: 0, description: 'note' }],
  collections: [{ id: 'c1', name: 'Work', order: 0 }]
};

suite('bookmarkMirror - serialization and hashing', () => {
  test('serializes as pretty-printed JSON with a trailing newline', () => {
    const content = serializeBookmarkData(sampleData);
    assert.ok(content.endsWith('\n'));
    assert.ok(content.includes('\n  "version": 2'));
    assert.deepStrictEqual(JSON.parse(content), sampleData);
  });

  test('serialization is stable for equal data', () => {
    assert.strictEqual(serializeBookmarkData(sampleData), serializeBookmarkData({ ...sampleData }));
  });

  test('hashContent is stable, and differs for different content', () => {
    assert.strictEqual(hashContent('abc'), hashContent('abc'));
    assert.notStrictEqual(hashContent('abc'), hashContent('abd'));
  });
});

suite('bookmarkMirror - resolveMirrorLocation', () => {
  test('is disabled when no folder is open', () => {
    assert.strictEqual(resolveMirrorLocation(undefined).kind, 'disabled');
    assert.strictEqual(resolveMirrorLocation([]).kind, 'disabled');
  });

  test('is enabled for a single-root workspace, at <folder>/.vscode/bookmarks.json', () => {
    const folder = vscode.Uri.file('/workspace/project');
    const location = resolveMirrorLocation([{ uri: folder }]);

    assert.strictEqual(location.kind, 'enabled');
    assert.ok(location.kind === 'enabled');
    // Asserted against a literal, not against another joinPath call — comparing the
    // implementation to itself would pass even if the join were wrong.
    assert.ok(
      location.file.path.endsWith('/project/.vscode/bookmarks.json'),
      `unexpected mirror path: ${location.file.path}`
    );
  });

  test('is disabled for a multi-root workspace, with a reason', () => {
    const location = resolveMirrorLocation([
      { uri: vscode.Uri.file('/workspace/one') },
      { uri: vscode.Uri.file('/workspace/two') }
    ]);

    assert.strictEqual(location.kind, 'disabled');
    assert.ok(location.kind === 'disabled');
    assert.ok(location.reason.length > 0);
  });

  test('MIRROR_RELATIVE_PATH is the documented contract path', () => {
    assert.strictEqual(MIRROR_RELATIVE_PATH, '.vscode/bookmarks.json');
  });
});

suite('bookmarkMirror - WorkspaceMirrorFile (real filesystem)', () => {
  let root: vscode.Uri;

  setup(async () => {
    root = vscode.Uri.file(path.join(os.tmpdir(), `bookmarks-mirror-${randomUUID()}`));
    await vscode.workspace.fs.createDirectory(root);
  });

  teardown(async () => {
    await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
  });

  function mirrorFor(folder: vscode.Uri): WorkspaceMirrorFile {
    const location = resolveMirrorLocation([{ uri: folder }]);
    assert.ok(location.kind === 'enabled');
    return new WorkspaceMirrorFile(location);
  }

  test('read returns undefined when the file does not exist', async () => {
    assert.strictEqual(await mirrorFor(root).read(), undefined);
  });

  test('write creates .vscode/ and the file, and read returns exactly what was written', async () => {
    const mirror = mirrorFor(root);
    const content = serializeBookmarkData(sampleData);

    await mirror.write(content);

    assert.strictEqual(await mirror.read(), content);
  });

  test('write overwrites an existing file and leaves no temp file behind', async () => {
    const mirror = mirrorFor(root);
    await mirror.write('{"first": true}\n');
    await mirror.write('{"second": true}\n');

    assert.strictEqual(await mirror.read(), '{"second": true}\n');
    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(root, '.vscode'));
    assert.deepStrictEqual(entries.map(([name]) => name), ['bookmarks.json']);
  });

  test('write rejects when the target directory cannot be created', async () => {
    const blocker = vscode.Uri.file(path.join(root.fsPath, 'a-file-not-a-directory'));
    await vscode.workspace.fs.writeFile(blocker, Buffer.from('not a directory'));
    const mirror = mirrorFor(blocker);

    await assert.rejects(() => mirror.write('{}\n'));
  });
});
