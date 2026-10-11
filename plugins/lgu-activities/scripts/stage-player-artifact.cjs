const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const EXPECTED_COMMIT = 'df7ad50bbe6aa46c8c0aef576eef745185dbb76b';
const args = process.argv.slice(2);
const sourceIndex = args.indexOf('--source');
const commitIndex = args.indexOf('--commit');
const source = sourceIndex >= 0 ? path.resolve(args[sourceIndex + 1] || '') : '';
const commit = commitIndex >= 0 ? args[commitIndex + 1] : '';
if (!source || commit !== EXPECTED_COMMIT) {
  console.error(`Usage: node scripts/stage-player-artifact.cjs --source <dist/player> --commit ${EXPECTED_COMMIT}`);
  process.exit(2);
}
const manifestPath = path.join(source, 'manifest.json');
if (fs.readFileSync(path.join(source, 'COMMIT'), 'utf8').trim() !== commit) throw new Error('Artifact COMMIT mismatch');
const checksums = fs.readFileSync(path.join(source, 'SHA256SUMS'), 'utf8');
const verified = new Set();
for (const line of checksums.trim().split(/\r?\n/)) {
  const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line);
  if (!match) throw new Error('Invalid SHA256SUMS entry');
  const relative = match[2].replace(/^\.\//, '');
  const file = path.resolve(source, relative);
  if (!file.startsWith(`${source}${path.sep}`) || verified.has(relative) || !fs.lstatSync(file).isFile()) {
    throw new Error('Invalid or duplicate artifact path');
  }
  if (createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== match[1]) throw new Error(`Checksum mismatch: ${relative}`);
  verified.add(relative);
}
if (verified.size !== 13) throw new Error('Expected 13 checksummed artifact files');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.name !== 'lgu-live-player' || manifest.entry !== 'lgu-live-player.js'
  || manifest.stylesheet !== 'lgu-live-player.css' || manifest.types !== 'lgu-live-player.d.ts') {
  throw new Error('Unexpected LGU player manifest');
}
const required = ['lgu-live-player.js', 'lgu-live-player.css', 'lgu-live-player.d.ts', 'manifest.json',
  ...Object.keys(manifest.files || {}).filter(name => name.startsWith('fonts/'))];
for (const relative of required) {
  const file = path.resolve(source, relative);
  if (!file.startsWith(`${source}${path.sep}`) || !fs.statSync(file).isFile()) throw new Error(`Missing player artifact: ${relative}`);
}
const expected = new Set(['COMMIT', 'manifest.json', ...Object.keys(manifest.files || {})]);
if (expected.size !== 13 || [...expected].some(name => !verified.has(name))) throw new Error('Manifest/checksum file set mismatch');
for (const [relative, size] of Object.entries(manifest.files)) {
  if (fs.statSync(path.join(source, relative)).size !== size) throw new Error(`Size mismatch: ${relative}`);
}
const destination = path.resolve(__dirname, `../assets/player/${commit}`);
if (fs.existsSync(destination)) {
  for (const relative of [...verified, 'SHA256SUMS']) {
    if (!fs.readFileSync(path.join(source, relative)).equals(fs.readFileSync(path.join(destination, relative)))) {
      throw new Error('Immutable player artifact collision');
    }
  }
  console.log(`Verified existing immutable LGU player ${commit} (13 checksums)`);
  process.exit(0);
}
fs.mkdirSync(destination, { recursive: true });
for (const relative of [...verified, 'SHA256SUMS']) {
  const file = path.resolve(source, relative);
  if (!file.startsWith(`${source}${path.sep}`) || !fs.statSync(file).isFile()) throw new Error(`Invalid manifest path: ${relative}`);
  const target = path.join(destination, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(file, target);
}
console.log(`Staged official LGU player ${commit} (13 checksummed files + SHA256SUMS) at ${destination}`);
