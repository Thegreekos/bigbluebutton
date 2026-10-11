const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const manifest = require('../manifest.json');
const pkg = require('../package.json');
const webpack = require('../webpack.config.cjs');

test('manifest declares an optional non-secret activity ID and no LGU engine permissions', () => {
  assert.equal(manifest.name, 'LGUActivities');
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.requiredSdkVersion, '^0.1.26');
  assert.equal(pkg.dependencies['bigbluebutton-html-plugin-sdk'], '0.1.26');
  assert.equal(manifest.javascriptEntrypointUrl, `releases/${pkg.version}/LGUActivities.js`);
  assert.equal(manifest.eventPersistence.isEnabled, false);
  assert.equal(manifest.enabledForBreakoutRooms, false);
  for (const field of ['remoteDataSources', 'dataChannels', 'serverCommandsPermission']) {
    assert.equal(manifest[field], undefined);
  }
  assert.equal(manifest.settingsSchema[0].name, 'liveActivityId');
  assert.equal(manifest.settingsSchema[0].required, false);
  assert.equal(manifest.settingsSchema[0].defaultValue, '');
});

test('host React and isolated output follow Lesson Assistant build pattern', () => {
  assert.equal(webpack.externals.react, 'React');
  assert.equal(webpack.output.iife, true);
  assert.equal(webpack.output.filename, manifest.javascriptEntrypointUrl);
  assert.equal(webpack.output.path, path.resolve(__dirname, '../dist'));
});

test('browser has no direct LGU calls, shared storage, signing keys or server modules', () => {
  const src = path.join(__dirname, '../src');
  const source = fs.readdirSync(src).map((file) => fs.readFileSync(path.join(src, file), 'utf8')).join('\n');
  assert.doesNotMatch(source, /XMLHttpRequest|WebSocket|localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(source.replaceAll('https://lgu.thegreekos.com', ''), /https?:\/\//);
  assert.doesNotMatch(source, /useCustomMutation|useDataChannel|privateKey|require\(['"]\.\.\/server/);
  assert.match(source, /\/api\/lgu-activities\/v1\//);
  assert.match(source, /user_metadata/);
  assert.match(source, /df7ad50bbe6aa46c8c0aef576eef745185dbb76b/);
  assert.doesNotMatch(source, /56e438e67c977113bcbd513591d440b2b140e893/);
  assert.doesNotMatch(source, /function QuestionForm|live-question|live-answer/);
  assert.equal(fs.existsSync(path.join(src, 'live-panel.js')), false);
  assert.doesNotMatch(JSON.stringify(pkg), /refs\/pull\/46|github.*lgu/i);
});