import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension activation', () => {
  test('extension is present and activates', async () => {
    const ext = vscode.extensions.getExtension('cbeaulieu-gt.vscode-bookmarks-plus');
    assert.ok(ext, 'extension not found — check "publisher"/"name" in package.json');
    await ext!.activate();
    assert.strictEqual(ext!.isActive, true);
  });

  test('activation registers every bookmarks.* command', async () => {
    const ext = vscode.extensions.getExtension('cbeaulieu-gt.vscode-bookmarks-plus');
    assert.ok(ext, 'extension not found — check "publisher"/"name" in package.json');
    await ext!.activate();

    const commands = await vscode.commands.getCommands(true);
    const expected = [
      'bookmarks.addFile',
      'bookmarks.addFolder',
      'bookmarks.remove',
      'bookmarks.reveal',
      'bookmarks.newCollection',
      'bookmarks.renameCollection',
      'bookmarks.deleteCollection',
      'bookmarks.moveToCollection',
      'bookmarks.toggleGroupByRepo',
      'bookmarks.refresh'
    ];

    for (const command of expected) {
      assert.ok(commands.includes(command), `expected command "${command}" to be registered`);
    }
  });
});

suite('Extension - mirror wiring', () => {
  test('activation succeeds and does not throw regardless of the workspace shape', async () => {
    const ext = vscode.extensions.getExtension('cbeaulieu-gt.vscode-bookmarks-plus');
    assert.ok(ext);
    await ext!.activate();
    assert.strictEqual(ext!.isActive, true);
  });

  test('the setDescription command is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('bookmarks.setDescription'));
  });
});
