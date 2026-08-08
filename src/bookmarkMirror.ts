import { createHash, randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { BookmarkData } from './types';

export const MIRROR_RELATIVE_PATH = '.vscode/bookmarks.json';

const MIRROR_DIRECTORY = '.vscode';
const MIRROR_FILENAME = 'bookmarks.json';

export type MirrorLocation =
  | { kind: 'enabled'; folder: vscode.Uri; directory: vscode.Uri; file: vscode.Uri }
  | { kind: 'disabled'; reason: string };

export function serializeBookmarkData(data: BookmarkData): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function resolveMirrorLocation(
  folders: readonly { uri: vscode.Uri }[] | undefined
): MirrorLocation {
  if (!folders || folders.length === 0) {
    return { kind: 'disabled', reason: 'no workspace folder is open' };
  }

  if (folders.length > 1) {
    return {
      kind: 'disabled',
      reason: 'multi-root workspaces are not supported by the bookmarks mirror yet'
    };
  }

  const folder = folders[0].uri;
  const directory = vscode.Uri.joinPath(folder, MIRROR_DIRECTORY);
  return {
    kind: 'enabled',
    folder,
    directory,
    file: vscode.Uri.joinPath(directory, MIRROR_FILENAME)
  };
}

export interface MirrorPort {
  read(): Promise<string | undefined>;
  write(content: string): Promise<void>;
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
}

export class WorkspaceMirrorFile implements MirrorPort {
  constructor(
    private readonly location: { directory: vscode.Uri; file: vscode.Uri },
    private readonly fs: vscode.FileSystem = vscode.workspace.fs
  ) {}

  async read(): Promise<string | undefined> {
    try {
      const bytes = await this.fs.readFile(this.location.file);
      return new TextDecoder('utf-8').decode(bytes);
    } catch (error: unknown) {
      if (isFileNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async write(content: string): Promise<void> {
    const tempFile = vscode.Uri.joinPath(
      this.location.directory,
      `${MIRROR_FILENAME}.${randomUUID()}.tmp`
    );
    await this.fs.createDirectory(this.location.directory);
    await this.fs.writeFile(tempFile, new TextEncoder().encode(content));
    try {
      await this.fs.rename(tempFile, this.location.file, { overwrite: true });
    } catch (error: unknown) {
      try {
        await this.fs.delete(tempFile, { recursive: false, useTrash: false });
      } catch {
        // Best-effort cleanup must not replace the original rename error.
      }
      throw error;
    }
  }
}
