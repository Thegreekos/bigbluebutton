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
for (const key of ['remoteDataSources', 'dataChannels', 'serverCommandsPermission']) {
  assert.equal(manifest[key], undefined, `Shell must not configure ${key}`);
}
assert.deepEqual(manifest.settingsSchema, [
  { name: 'liveActivityId', label: 'Server-approved LGU activity ID', required: false, type: 'string', defaultValue: '' },
]);
assert.doesNotMatch(bundle.toString(), /fixture-core-|fixture-bbb-|fixture-ephemeral-key|BEGIN PRIVATE KEY/);
assert.doesNotMatch(bundle.toString(), /classroom_introspection_token|classroom\/token\/introspect|CORE_SERVICE_AUTH_FAILED/);
assert.doesNotMatch(bundle.toString(), /federation_issuer_secret|LGU-FEDERATION-V1|X-LGU-Federation-Signature|lgu_fed=|lgu_session=|lgu_live=/i);
assert.equal(manifest.eventPersistence.isEnabled, false);
assert.equal(manifest.enabledForBreakoutRooms, false);
console.log(`Bundle/manifest/SDK/SRI checks passed (${bundle.length} bytes).`);