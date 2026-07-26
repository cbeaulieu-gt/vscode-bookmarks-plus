import * as assert from 'assert';

// scripts/guard-channel.js is a plain CommonJS Node script (no vscode dependency,
// not part of the tsc build), so it is pulled in with a runtime require() rather
// than an import. The path is relative to the *compiled* location of this file
// (out/test/suite/guardChannel.test.js), not its source location.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { validateChannel } = require('../../../scripts/guard-channel.js');

suite('guard-channel.validateChannel', () => {
  test('accepts an even-minor version on the stable channel', () => {
    assert.doesNotThrow(() => validateChannel('1.0.0', 'stable'));
  });

  test('accepts an odd-minor version on the prerelease channel', () => {
    assert.doesNotThrow(() => validateChannel('1.1.0', 'prerelease'));
  });

  test('returns undefined when the channel matches the version parity', () => {
    assert.strictEqual(validateChannel('2.4.6', 'stable'), undefined);
  });

  test('throws when an even-minor version is published on the prerelease channel', () => {
    assert.throws(() => validateChannel('1.2.0', 'prerelease'), Error);
  });

  test('throws when an odd-minor version is published on the stable channel', () => {
    assert.throws(() => validateChannel('1.3.0', 'stable'), Error);
  });

  test('throws on a channel name that is not "stable" or "prerelease"', () => {
    assert.throws(() => validateChannel('1.0.0', 'nightly' as unknown as 'stable'), Error);
  });

  test('throws when the version has fewer than three dot-separated segments', () => {
    assert.throws(() => validateChannel('1.0', 'stable'), Error);
  });

  test('throws when the version has more than three dot-separated segments', () => {
    assert.throws(() => validateChannel('1.0.0.0', 'stable'), Error);
  });

  test('throws when the minor segment is not a parseable number', () => {
    assert.throws(() => validateChannel('1.x.0', 'stable'), Error);
  });

  test('throws when the version is an empty string', () => {
    assert.throws(() => validateChannel('', 'stable'), Error);
  });

  test('throws when the version is not a string', () => {
    assert.throws(() => validateChannel(undefined as unknown as string, 'stable'), Error);
  });
});
