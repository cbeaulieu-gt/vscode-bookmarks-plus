"use strict";

const fs = require("fs");
const path = require("path");

function validateChannel(version, channel) {
  if (channel !== "stable" && channel !== "prerelease") {
    throw new Error(`Invalid release channel: ${channel}`);
  }

  if (!version || typeof version !== "string") {
    throw new Error("Version must be a non-empty string");
  }

  const parts = version.split(".");
  if (parts.length !== 3) {
    throw new Error("Version must use the MAJOR.MINOR.PATCH format");
  }

  const minor = parseInt(parts[1], 10);
  if (Number.isNaN(minor)) {
    throw new Error(`Invalid minor version: ${parts[1]}`);
  }

  if (channel === "stable" && minor % 2 !== 0) {
    throw new Error(`Version ${version} belongs to the prerelease channel`);
  }

  if (channel === "prerelease" && minor % 2 === 0) {
    throw new Error(`Version ${version} belongs to the stable channel`);
  }
}

module.exports = { validateChannel };

if (require.main === module) {
  const channel = process.argv[2];

  if (channel !== "stable" && channel !== "prerelease") {
    process.stderr.write(
      "Usage: node scripts/guard-channel.js <stable|prerelease>\n"
    );
    process.exit(2);
  }

  let version;
  const packageJsonPath = path.resolve(__dirname, "..", "package.json");

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    if (!Object.prototype.hasOwnProperty.call(packageJson, "version")) {
      throw new Error("package.json is missing the version field");
    }
    version = packageJson.version;
  } catch (err) {
    process.stderr.write(`Unable to read package version: ${err.message}\n`);
    process.exit(3);
  }

  try {
    validateChannel(version, channel);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }

  process.exit(0);
}
