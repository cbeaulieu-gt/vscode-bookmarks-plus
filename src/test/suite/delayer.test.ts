import * as assert from 'assert';
import { Delayer } from '../../delayer';
import { sleep } from './fixtures';

suite('Delayer', () => {
  test('runs the task once after the delay elapses', async () => {
    let calls = 0;
    const delayer = new Delayer(10);

    delayer.trigger(() => {
      calls++;
    });
    assert.strictEqual(calls, 0, 'the task must not run synchronously');

    await sleep(40);
    assert.strictEqual(calls, 1);
    delayer.dispose();
  });

  test('coalesces a burst of triggers into a single run of the latest task', async () => {
    const ran: string[] = [];
    const delayer = new Delayer(20);

    delayer.trigger(() => {
      ran.push('first');
    });
    delayer.trigger(() => {
      ran.push('second');
    });
    delayer.trigger(() => {
      ran.push('third');
    });

    await sleep(60);
    assert.deepStrictEqual(ran, ['third']);
    delayer.dispose();
  });

  test('flush runs a pending task immediately and awaits it', async () => {
    let done = false;
    const delayer = new Delayer(10_000);

    delayer.trigger(async () => {
      await sleep(1);
      done = true;
    });
    await delayer.flush();

    assert.strictEqual(done, true, 'flush must await the task, not just start it');
    delayer.dispose();
  });

  test('flush with nothing pending resolves without error', async () => {
    const delayer = new Delayer(10);
    await delayer.flush();
    delayer.dispose();
  });

  test('flush does not re-run the task when the timer would later elapse', async () => {
    let calls = 0;
    const delayer = new Delayer(10);

    delayer.trigger(() => {
      calls++;
    });
    await delayer.flush();
    await sleep(40);

    assert.strictEqual(calls, 1);
    delayer.dispose();
  });

  test('dispose cancels a pending task', async () => {
    let calls = 0;
    const delayer = new Delayer(10);

    delayer.trigger(() => {
      calls++;
    });
    delayer.dispose();
    await sleep(40);

    assert.strictEqual(calls, 0);
  });

  test('a task that throws does not break subsequent triggers', async () => {
    let calls = 0;
    const delayer = new Delayer(10);

    delayer.trigger(() => {
      throw new Error('boom');
    });
    await sleep(40);
    delayer.trigger(() => {
      calls++;
    });
    await sleep(40);

    assert.strictEqual(calls, 1);
    delayer.dispose();
  });
});
