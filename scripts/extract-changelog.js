"use strict";

const fs = require("fs");
const path = require("path");

function extractChangelogSection(markdown, version) {
  if (
    !markdown ||
    typeof markdown !== "string" ||
    markdown.trim().length === 0
  ) {
    return null;
  }

  if (!version || typeof version !== "string") {
    return null;
  }

  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingPattern = new RegExp(
    `^## \\[${escapedVersion}\\][^\\n]*$`,
    "m"
  );
  const headingMatch = headingPattern.exec(markdown);

  if (!headingMatch) {
    return null;
  }

  const bodyStart = headingMatch.index + headingMatch[0].length;
  const remainder = markdown.slice(bodyStart);
  const nextHeading = /^## \[/m.exec(remainder);
  const body = nextHeading
    ? remainder.slice(0, nextHeading.index)
    : remainder;

  return body.trim();
}

module.exports = { extractChangelogSection };

if (require.main === module) {
  const version = process.argv[2];

  if (!version || typeof version !== "string") {
    process.stderr.write(
      "Usage: node scripts/extract-changelog.js <version>\n"
    );
    process.exit(3);
  }

  let markdown;
  const changelogPath = path.join(__dirname, "..", "CHANGELOG.md");

  try {
    markdown = fs.readFileSync(changelogPath, "utf8");
  } catch (err) {
    process.stderr.write(`Unable to read CHANGELOG.md: ${err.message}\n`);
    process.exit(2);
  }

  const section = extractChangelogSection(markdown, version);
  if (section === null) {
    process.stderr.write(`Changelog section for ${version} not found\n`);
    process.exit(1);
  }

  process.stdout.write(`${section}\n`);
  process.exit(0);
}
