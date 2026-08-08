export type DelayedTask = () => void | Promise<void>;

/**
 * Debounces tasks using the model from VS Code core's own `Delayer` in
 * `src/vs/base/common/async.ts`. It is reproduced here because that module is
 * not published as an importable package. `flush()` and `dispose()` close the
 * timer-disposal gap left as a known limitation in GitDoc's similar debounce
 * closure.
 */
export class Delayer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: DelayedTask | undefined;
  private runningTask: Promise<void> | undefined;

  constructor(private readonly delayMs: number) {}

  trigger(task: DelayedTask): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
    }

    this.pending = task;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const pendingTask = this.pending;
      this.pending = undefined;

      if (pendingTask !== undefined) {
        void this.start(pendingTask);
      }
    }, this.delayMs);
  }

  async flush(): Promise<void> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    const pendingTask = this.pending;
    this.pending = undefined;

    if (pendingTask !== undefined) {
      await this.start(pendingTask);
    } else if (this.runningTask !== undefined) {
      await this.runningTask;
    }
  }

  dispose(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    this.pending = undefined;
  }

  private async run(pendingTask: DelayedTask): Promise<void> {
    try {
      await pendingTask();
    } catch {
      // A failed task must not prevent later tasks from running.
    }
  }

  private start(pendingTask: DelayedTask): Promise<void> {
    const runningTask = this.run(pendingTask);
    this.runningTask = runningTask;
    void runningTask.finally(() => {
      if (this.runningTask === runningTask) {
        this.runningTask = undefined;
      }
    });
    return runningTask;
  }
}
