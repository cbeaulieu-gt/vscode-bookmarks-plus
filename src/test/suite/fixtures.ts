import * as vscode from 'vscode';
import { Prompter } from '../../commands';

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

export interface FakePrompterOptions {
  inputBoxResult?: string | undefined;
  quickPickResult?: unknown;
  warningConfirmResult?: boolean;
  infoResult?: unknown;
}

/**
 * A configurable fake of the extension's `Prompter` interface.
 *
 * `inputBoxResult` mirrors the real `showInputBox` contract: passing
 * `undefined` simulates the user dismissing the box, and passing `''`
 * simulates the user submitting an empty value. `lastInputBoxOptions` and
 * `inputBoxCallCount` let tests assert what was shown (e.g. the pre-filled
 * `value`) and whether the box was opened at all.
 */
export class FakePrompter implements Prompter {
  lastInputBoxOptions: vscode.InputBoxOptions | undefined;
  inputBoxCallCount = 0;

  private readonly inputBoxResult: string | undefined;
  private readonly quickPickResult: unknown;
  private readonly warningConfirmResult: boolean;
  private readonly infoResult: unknown;

  constructor(options: FakePrompterOptions = {}) {
    this.inputBoxResult = options.inputBoxResult;
    this.quickPickResult = options.quickPickResult;
    this.warningConfirmResult = options.warningConfirmResult ?? false;
    this.infoResult = options.infoResult;
  }

  showInputBox(options: vscode.InputBoxOptions): Thenable<string | undefined> {
    this.inputBoxCallCount++;
    this.lastInputBoxOptions = options;
    return Promise.resolve(this.inputBoxResult);
  }

  showQuickPick<T extends vscode.QuickPickItem>(): Thenable<T | undefined> {
    return Promise.resolve(this.quickPickResult as T | undefined);
  }

  showWarningConfirm(): Thenable<boolean> {
    return Promise.resolve(this.warningConfirmResult);
  }

  showInfo(): Thenable<unknown> {
    return Promise.resolve(this.infoResult);
  }
}
