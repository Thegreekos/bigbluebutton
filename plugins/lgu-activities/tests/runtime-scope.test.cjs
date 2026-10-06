const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scopeBbbVerifier } = require('../server/production-integration.cjs');

test('explicit empty scope denies all, single scope accepts only verified external meeting', async () => {
  const verify = async () => ({ externalMeetingId: 'approved' });
  await assert.rejects(scopeBbbVerifier(verify, [])({}), e => e.code === 'MEETING_SCOPE_DENIED');
  assert.equal((await scopeBbbVerifier(verify, ['approved'])({})).externalMeetingId, 'approved');
  await assert.rejects(scopeBbbVerifier(verify, ['other'])({}), e => e.code === 'MEETING_SCOPE_DENIED');
  const list = ['other']; const scoped = scopeBbbVerifier(verify, list); list.push('approved');
  await assert.rejects(scoped({}), e => e.code === 'MEETING_SCOPE_DENIED');
});

test('scope rejects malformed config and propagates upstream proof rejection', async () => {
  for (const value of [null, 'all', [null], ['']]) assert.throws(() => scopeBbbVerifier(async () => ({}), value));
  await assert.rejects(scopeBbbVerifier(async () => { throw new Error('unauthorized'); }, ['approved'])({}), /unauthorized/);
});

test('deployment is non-root, hardened, loopback and has no fixture/default global activation', () => {
  const unit = fs.readFileSync(path.join(__dirname, '../deploy/bbb-lgu-activities.service'), 'utf8');
  const runtime = fs.readFileSync(path.join(__dirname, '../server/runtime.cjs'), 'utf8');
  const proxy = fs.readFileSync(path.join(__dirname, '../deploy/lgu-activities.nginx'), 'utf8');
  assert.match(unit, /User=bigbluebutton/); assert.match(unit, /ProtectSystem=strict/);
  assert.match(unit, /NoNewPrivileges=true/); assert.match(unit, /UMask=0077/);
  assert.match(runtime, /server\.listen\(4703, '127\.0\.0\.1'/);
  assert.match(runtime, /allowedMeetingIds/);
  assert.doesNotMatch(runtime, /identity-fixture|fixture-core-|console\.log\(.*config/);
  assert.match(proxy, /access_log off/); assert.match(proxy, /proxy_cache off/);
});