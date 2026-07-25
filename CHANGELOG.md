# Changelog

All notable changes to the "Bookmarks Plus" extension are documented in this file.

## [0.1.0] - Unreleased

### Added

- Bookmark files and folders (not just lines) per workspace, for single-root and multi-root workspaces.
- Collections: group bookmarks, rename and delete collections (deleting ungroups rather than deletes items).
- Drag-and-drop reordering and cross-collection moves.
- Group-by-repo view, with an "Unknown" bucket for items with no resolvable repo.
- Broken-bookmark detection (missing path) with a warning icon; no auto-fix, remove manually.
- Repo-name badges resolved live via the built-in `vscode.git` extension (soft dependency — omitted silently if unavailable).
