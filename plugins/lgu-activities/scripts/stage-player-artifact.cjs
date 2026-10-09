const fs = require('node:fs');
const path = require('node:path');

const EXPECTED_COMMIT = '56e438e67c977113bcbd513591d440b2b140e893';
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
const destination = path.resolve(__dirname, `../assets/player/${commit}`);
fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
for (const relative of Object.keys(manifest.files || {})) {
  const file = path.resolve(source, relative);
  if (!file.startsWith(`${source}${path.sep}`) || !fs.statSync(file).isFile()) throw new Error(`Invalid manifest path: ${relative}`);
  const target = path.join(destination, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(file, target);
}
fs.copyFileSync(manifestPath, path.join(destination, 'manifest.json'));
console.log(`Staged LGU player ${commit} (${Object.keys(manifest.files).length} files) at ${destination}`);
