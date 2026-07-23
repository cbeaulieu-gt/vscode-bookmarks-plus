import * as assert from 'assert';
import { FsGitCache } from '../../fsGitCache';

suite('FsGitCache', () => {
  test('caches the resolved entry and does not call resolve twice for the same uri', async () => {
    let calls = 0;
    const cache = new FsGitCache(async () => {
      calls++;
      return { exists: true, repoName: 'repo-a' };
    });

    const first = await cache.get('file:///a.txt');
    const second = await cache.get('file:///a.txt');

    assert.deepStrictEqual(first, { exists: true, repoName: 'repo-a' });
    assert.deepStrictEqual(second, { exists: true, repoName: 'repo-a' });
    assert.strictEqual(calls, 1);
  });

  test('resolves different uris independently', async () => {
    const cache = new FsGitCache(async (uri) => ({ exists: true, repoName: uri }));
    const a = await cache.get('file:///a.txt');
    const b = await cache.get('file:///b.txt');
    assert.strictEqual(a.repoName, 'file:///a.txt');
    assert.strictEqual(b.repoName, 'file:///b.txt');
  });

  test('invalidateAll clears the cache so the next get() resolves again', async () => {
    let calls = 0;
    const cache = new FsGitCache(async () => {
      calls++;
      return { exists: true };
    });

    await cache.get('file:///a.txt');
    cache.invalidateAll();
    await cache.get('file:///a.txt');

    assert.strictEqual(calls, 2);
  });
});
