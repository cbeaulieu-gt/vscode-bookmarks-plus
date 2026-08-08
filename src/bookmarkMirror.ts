import { createHash } from 'crypto';
import * as vscode from 'vscode';
import { BookmarkData } from './types';

export const MIRROR_RELATIVE_PATH = '.vscode/bookmarks.json';

const MIRROR_DIRECTORY = '.vscode';
const MIRROR_FILENAME = 'bookmarks.json';
const MIRROR_TEMP_FILENAME = 'bookmarks.json.tmp';

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
  private readonly tempFile: vscode.Uri;

  constructor(
    private readonly location: { directory: vscode.Uri; file: vscode.Uri },
    private readonly fs: vscode.FileSystem = vscode.workspace.fs
  ) {
    this.tempFile = vscode.Uri.joinPath(location.directory, MIRROR_TEMP_FILENAME);
  }

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
    await this.fs.createDirectory(this.location.directory);
    await this.fs.writeFile(this.tempFile, new TextEncoder().encode(content));
    await this.fs.rename(this.tempFile, this.location.file, { overwrite: true });
  }
}
