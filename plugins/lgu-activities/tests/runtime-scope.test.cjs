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

test('deployment is non-root, hardened, loopback and explicitly requires verified BBB scope and approved activities', () => {
  const unit = fs.readFileSync(path.join(__dirname, '../deploy/bbb-lgu-activities.service'), 'utf8');
  const runtime = fs.readFileSync(path.join(__dirname, '../server/runtime.cjs'), 'utf8');
  const proxy = fs.readFileSync(path.join(__dirname, '../deploy/lgu-activities.nginx'), 'utf8');
  assert.match(unit, /User=bigbluebutton/); assert.match(unit, /ProtectSystem=strict/);
  assert.match(unit, /NoNewPrivileges=true/); assert.match(unit, /UMask=0077/);
  assert.match(runtime, /server\.listen\(4703, '127\.0\.0\.1'/);
  assert.match(runtime, /config\.meetingScope !== 'all-verified-bbb'/);
  assert.match(runtime, /!Array\.isArray\(config\.allowedActivityIds\)/);
  assert.match(runtime, /resolveActivity: async \(id\) => config\.allowedActivityIds\.includes\(id\)/);
  assert.doesNotMatch(runtime, /identity-fixture|fixture-core-|console\.log\(.*config/);
  assert.match(proxy, /access_log off/); assert.match(proxy, /proxy_cache off/);
  assert.match(proxy, /limit_req zone=lgu_identity_requests burst=60 nodelay/);
  assert.match(proxy, /limit_req_status 429/);
  const limits = fs.readFileSync(path.join(__dirname, '../deploy/lgu-activities-rate-limit.conf'), 'utf8');
  assert.match(limits, /\$binary_remote_addr.*rate=30r\/s/);
  const config = require('../deploy/adapter.example.json');
  assert.equal(config.meetingScope, 'all-verified-bbb');
  assert.equal(config.allowedMeetingIds, undefined);
});

test('omitted meeting allowlist accepts independently verified BBB rooms but propagates proof rejection', async () => {
  const calls = [];
  const verify = scopeBbbVerifier(async proof => {
    calls.push(proof);
    if (proof.sessionToken === 'invalid') throw new Error('unauthorized');
    return { externalMeetingId: proof.sessionToken };
  });
  for (const sessionToken of ['verified-room-one', 'verified-room-two']) {
    assert.equal((await verify({ sessionToken })).externalMeetingId, sessionToken);
  }
  await assert.rejects(verify({ sessionToken: 'invalid' }), /unauthorized/);
  assert.equal(calls.length, 3);
});