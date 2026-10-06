const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const manifest = require('../manifest.json');
const pkg = require('../package.json');
const webpack = require('../webpack.config.cjs');

test('manifest declares only an SDK integration shell', () => {
  assert.equal(manifest.name, 'LGUActivities');
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.requiredSdkVersion, '^0.1.26');
  assert.equal(pkg.dependencies['bigbluebutton-html-plugin-sdk'], '0.1.26');
  assert.equal(manifest.javascriptEntrypointUrl, `releases/${pkg.version}/LGUActivities.js`);
  assert.equal(manifest.eventPersistence.isEnabled, false);
  assert.equal(manifest.enabledForBreakoutRooms, false);
  for (const field of ['remoteDataSources', 'dataChannels', 'serverCommandsPermission', 'settingsSchema']) {
    assert.equal(manifest[field], undefined);
  }
});

test('host React and isolated output follow Lesson Assistant build pattern', () => {
  assert.equal(webpack.externals.react, 'React');
  assert.equal(webpack.output.iife, true);
  assert.equal(webpack.output.filename, manifest.javascriptEntrypointUrl);
  assert.equal(webpack.output.path, path.resolve(__dirname, '../dist'));
});

test('runtime source has no network, identity/token lookup, game engine or shared storage', () => {
  const src = path.join(__dirname, '../src');
  const source = fs.readdirSync(src).map((file) => fs.readFileSync(path.join(src, file), 'utf8')).join('\n');
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(source, /useCustomQuery|useCustomMutation|useCustomSubscription|useDataChannel|getSessionToken|https?:\/\//);
  assert.doesNotMatch(JSON.stringify(pkg), /refs\/pull\/46|github.*lgu/i);
});