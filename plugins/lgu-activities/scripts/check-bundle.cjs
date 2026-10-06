const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const source = require('../manifest.json');
const manifest = require('../dist/manifest.json');
const pkg = require('../package.json');
const bundle = fs.readFileSync(path.join(__dirname, '../dist', manifest.javascriptEntrypointUrl));
assert.equal(pkg.dependencies['bigbluebutton-html-plugin-sdk'], '0.1.26');
assert.equal(source.requiredSdkVersion, '^0.1.26');
assert.equal(manifest.name, 'LGUActivities');
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.javascriptEntrypointUrl, `releases/${pkg.version}/LGUActivities.js`);
assert.equal(manifest.javascriptEntrypointIntegrity,
  `sha384-${createHash('sha384').update(bundle).digest('base64')}`);
for (const key of ['remoteDataSources', 'dataChannels', 'serverCommandsPermission', 'settingsSchema']) {
  assert.equal(manifest[key], undefined, `Shell must not configure ${key}`);
}
assert.equal(manifest.eventPersistence.isEnabled, false);
assert.equal(manifest.enabledForBreakoutRooms, false);
console.log(`Bundle/manifest/SDK/SRI checks passed (${bundle.length} bytes).`);