import * as assert from 'assert';

// scripts/extract-changelog.js is a plain CommonJS Node script (no vscode dependency,
// not part of the tsc build), so it is pulled in with a runtime require() rather
// than an import. The path is relative to the *compiled* location of this file
// (out/test/suite/extractChangelog.test.js), not its source location.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { extractChangelogSection } = require('../../../scripts/extract-changelog.js');

// Headings carry a trailing " — YYYY-MM-DD" date, matching this repo's real
// CHANGELOG.md convention (docs/release-strategy.md § "Cutting a release":
// `## [X.Y.Z] — YYYY-MM-DD`). The match must key off "## [<version>]" as a
// prefix of the heading line, not require it to be the entire line — an
// implementation that anchors the pattern to end-of-line would silently
// return null against every real changelog entry.
const markdown = [
  '## [2.0.0] — 2026-03-01',
  '### Added',
  '- Something shiny',
  '',
  '## [1.2.0] — 2026-01-15',
  '',
  '### Fixed',
  '- Squashed a bug',
  '',
  '## [1.0.0] — 2025-12-01',
  '### Added',
  '- Initial release'
].join('\n');

suite('extract-changelog.extractChangelogSection', () => {
  test('extracts a middle section, bounded by the next "## [" heading', () => {
    const section = extractChangelogSection(markdown, '1.2.0');
    assert.strictEqual(section, '### Fixed\n- Squashed a bug');
  });

  test('extracts the last section, unbounded to the end of the string', () => {
    const section = extractChangelogSection(markdown, '1.0.0');
    assert.strictEqual(section, '### Added\n- Initial release');
  });

  test('returns null when no heading matches the requested version', () => {
    assert.strictEqual(extractChangelogSection(markdown, '9.9.9'), null);
  });

  test('returns null for an empty markdown string', () => {
    assert.strictEqual(extractChangelogSection('', '1.0.0'), null);
  });

  test('returns null for a whitespace-only markdown string', () => {
    assert.strictEqual(extractChangelogSection('   \n\t  ', '1.0.0'), null);
  });

  test('returns null when markdown is not a string', () => {
    assert.strictEqual(extractChangelogSection(undefined as unknown as string, '1.0.0'), null);
  });

  test('returns null for an empty version string', () => {
    assert.strictEqual(extractChangelogSection(markdown, ''), null);
  });

  test('returns null when version is not a string', () => {
    assert.strictEqual(extractChangelogSection(markdown, undefined as unknown as string), null);
  });

  test('treats dots in the version as literal characters, not regex wildcards', () => {
    // The discriminating direction: a naive implementation that builds
    // `## [${version}]` straight into a RegExp (no escaping) would let the
    // dots in "1.2.0" match the "x" and "y" below as wildcards, since
    // regex "1.2.0" = 1, <any char>, 2, <any char>, 0 — which the literal
    // text "1x2y0" satisfies. A correct (escaped) implementation must not
    // match this decoy heading, since no "## [1.2.0]" heading exists here.
    const decoyMarkdown = ['## [1x2y0] — 2026-01-01', '### Should not match', '- decoy content'].join('\n');
    assert.strictEqual(extractChangelogSection(decoyMarkdown, '1.2.0'), null);
  });

  test('does not match an unrelated heading when the looked-up version itself contains no dots', () => {
    // Non-discriminating converse (kept for completeness, per spec): "1x2y0"
    // has no regex metacharacters, so this passes regardless of escaping.
    assert.strictEqual(extractChangelogSection(markdown, '1x2y0'), null);
  });
});
