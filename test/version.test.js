// Keeps the version in step across the files that show it: manifest.json (what chrome://extensions shows),
// package.json, the root of package-lock.json, and the newest entry in the README changelog.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const readText = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const SEMVER = /^\d+\.\d+\.\d+$/;

test('manifest.json and package.json have the same version, and it is a plain x.y.z number', () => {
  const manifest = readJson('manifest.json');
  const pkg = readJson('package.json');
  assert.match(manifest.version, SEMVER);
  assert.equal(pkg.version, manifest.version, 'package.json matches manifest.json');
});

test('the manifest version_name, if set, is the same as its version', () => {
  const manifest = readJson('manifest.json');
  if ('version_name' in manifest) assert.equal(manifest.version_name, manifest.version);
});

test('the root of package-lock.json has the same version as package.json', () => {
  const lock = readJson('package-lock.json');
  const pkg = readJson('package.json');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
});

test('the newest README changelog entry is the current version', () => {
  const readme = readText('README.md');
  const section = /^## Changelog\n([\s\S]*?)(?=^## )/m.exec(readme);
  assert.ok(section, 'the README has a Changelog section');
  const entries = [...section[1].matchAll(/^### (\S+)$/gm)].map((m) => m[1]);
  assert.ok(entries.length > 0, 'the changelog has at least one entry');
  assert.equal(entries[0], readJson('manifest.json').version, 'the newest entry is the version in the manifest');
  for (const entry of entries) assert.match(entry, SEMVER);
});
