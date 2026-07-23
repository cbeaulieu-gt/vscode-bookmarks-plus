import * as vscode from 'vscode';

export class FakeMemento implements vscode.Memento {
  private store = new Map<string, unknown>();
  updateCallCount = 0;

  constructor(initial?: Record<string, unknown>) {
    if (initial) {
      for (const [key, value] of Object.entries(initial)) {
        this.store.set(key, value);
      }
    }
  }

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.store.has(key) ? (this.store.get(key) as T) : defaultValue;
  }

  update(key: string, value: unknown): Thenable<void> {
    this.store.set(key, value);
    this.updateCallCount++;
    return Promise.resolve();
  }

  keys(): readonly string[] {
    return [...this.store.keys()];
  }

  setKeysForSync(): void {
    // Not used by BookmarkStore; present only to satisfy vscode.Memento's shape if extended later.
  }
}

export class FakeOutput {
  lines: string[] = [];
  appendLine(value: string): void {
    this.lines.push(value);
  }
}
