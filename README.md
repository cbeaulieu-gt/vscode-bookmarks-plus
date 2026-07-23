# vscode-bookmarks-plus

VSCode extension to bookmark files and folders (not just lines) in a workspace, with collections and git-repo awareness.

Status: in design — see `docs/superpowers/specs/` for the current spec.

## Development

- `npm install` — install dependencies
- `npm run compile` — bundle `src/extension.ts` to `dist/extension.js` via esbuild
- `npm test` — compile tests, then run the full suite in a headless VS Code Extension Development Host
- Press F5 in VS Code (or use the "Run Extension" launch config) to open an Extension Development Host with the extension loaded
