const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCoreCredentialVerifier, CORE_ENDPOINT, CORE_ISSUER, readSecretFile } = require('../server/core-introspection.cjs');
const { createIdentityFixture } = require('./fixtures/identity-fixture.cjs');
const { createIdentityService } = require('../server/identity-service.cjs');
const now = 1791298800;
const bbb = Object.freeze({ extId: 'person-A', externalMeetingId: 'external-lesson', meetingId: 'internal-incarnation',
  participantId: 'w_student_A', moderator: false, online: true });
const active = (expected = bbb) => ({ data: { active: true, reason: 'OK', subject: {
  kind: 'lesson', personId: expected.extId, role: expected.moderator ? 'teacher' : 'student',
  meetingId: expected.externalMeetingId, lessonSessionId: 'lesson-session-fixture',
  expiresAt: new Date((now + 120) * 1000).toISOString(),
}, session: { provider: 'bbb4', status: 'active', lessonId: 'lesson-fixture', classId: 'class-fixture',
  teacherPersonId: expected.moderator ? expected.extId : 'person-teacher' } },
meta: { readOnly: true, preview: false, dryRun: false }, error: null });
const reader = () => 'test-service-credential-not-a-real-secret';
const rejects = (promise, code, status) => assert.rejects(promise, (e) => e.code === code && e.status === status);

test('active Core subject is bound to server BBB proof; no positive cache and no cookie/redirect forwarding', async () => {
  const calls = [];
  let reads = 0;
  const verify = createCoreCredentialVerifier({ clock: () => now, readCredential: () => { reads += 1; return reader(); },
    fetchImpl: async (url, options) => { calls.push({ url, options }); return Response.json(active()); } });
  for (let i = 0; i < 2; i += 1) {
    const result = await verify('fixture-own-core-token', bbb);
    assert.deepEqual(result, { issuer: CORE_ISSUER, personId: 'person-A', role: 'student', meetingId: 'external-lesson',
      participantId: 'w_student_A', expiresAt: now + 120, membershipActive: true, lessonSessionId: 'lesson-session-fixture' });
  }
  assert.equal(reads, 2); assert.equal(calls.length, 2);
  for (const { url, options } of calls) {
    assert.equal(url, CORE_ENDPOINT);
    assert.deepEqual(JSON.parse(options.body), { token: 'fixture-own-core-token', expected: {
      personId: 'person-A', meetingId: 'external-lesson', kind: 'lesson' } });
    assert.equal(options.headers.Authorization, `Bearer ${reader()}`);
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store');
  }
});

test('BBB moderator flag is not sent as an expected Core role', async () => {
  const teacher = { ...bbb, extId: 'person-teacher', moderator: true };
  const verify = createCoreCredentialVerifier({ clock: () => now, readCredential: reader,
    fetchImpl: async (_url, options) => {
      assert.deepEqual(JSON.parse(options.body).expected, {
        personId: teacher.extId, meetingId: teacher.externalMeetingId, kind: 'lesson' });
      return Response.json(active(teacher));
    } });
  assert.equal((await verify('fixture-teacher-token', teacher)).role, 'teacher');
});

test('introspection accepts valid Core teacher/viewer and student/moderator associations independently', async () => {
  for (const [role, moderator] of [['teacher', false], ['student', true]]) {
    const verifiedBbb = { ...bbb, moderator };
    const result = active();
    result.data.subject.role = role;
    result.data.session.teacherPersonId = role === 'teacher' ? bbb.extId : 'another-teacher';
    const verify = createCoreCredentialVerifier({ clock: () => now, readCredential: reader,
      fetchImpl: async (_url, options) => {
        assert.deepEqual(JSON.parse(options.body), { token: 'fixture', expected: {
          personId: bbb.extId, meetingId: bbb.externalMeetingId, kind: 'lesson' } });
        return Response.json(result);
      } });
    assert.equal((await verify('fixture', verifiedBbb)).role, role);
  }
});

test('Core created BBB room accepts active bound identity; inactive and ended still deny', async () => {
  const result = active();
  result.data.session.status = 'created';
  const verify = createCoreCredentialVerifier({ clock: () => now, readCredential: reader,
    fetchImpl: async () => Response.json(result) });
  assert.equal((await verify('fixture', bbb)).personId, bbb.extId);
  result.data.active = false;
  await rejects(verify('fixture', bbb), 'CORE_IDENTITY_INACTIVE', 403);
  result.data.active = true; result.data.session.status = 'ended';
  await rejects(verify('fixture', bbb), 'CORE_SESSION_INVALID', 403);
});

test('inactive person mismatch denies and never exposes response subject or mismatch data', async () => {
  const verify = createCoreCredentialVerifier({ readCredential: reader,
    fetchImpl: async () => Response.json({ data: { active: false, mismatches: ['personId'], subject: { personId: 'do-not-disclose' } } }) });
  await rejects(verify('fixture-student-B-token', bbb), 'CORE_IDENTITY_INACTIVE', 403);
});

test('inactive mismatch evidence contains only allowlisted field-name enums, never subject values', async () => {
  const verify = createCoreCredentialVerifier({ readCredential: reader,
    fetchImpl: async () => Response.json({ data: { active: false,
      mismatches: ['personId', 'secret-value', 'personId', 'role'], subject: { personId: 'not-for-output' } } }) });
  await assert.rejects(verify('fixture', bbb), e => {
    assert.deepEqual(e.mismatches, ['personId', 'role']);
    assert.doesNotMatch(JSON.stringify(e), /not-for-output|secret-value/);
    return e.code === 'CORE_IDENTITY_INACTIVE';
  });
});

for (const [status, code] of [[400, 'CORE_INTROSPECTION_REQUEST_INVALID'], [401, 'CORE_SERVICE_AUTH_FAILED'],
  [503, 'CORE_INTROSPECTION_UNAVAILABLE'], [500, 'CORE_INTROSPECTION_UNAVAILABLE'], [302, 'CORE_INTROSPECTION_UNAVAILABLE']]) {
  test(`HTTP ${status} fails closed with sanitized service/request error`, async () => {
    const verify = createCoreCredentialVerifier({ readCredential: reader,
      fetchImpl: async () => Response.json({ error: 'sensitive upstream details' }, { status }) });
    await rejects(verify('fixture-token', bbb), code, 503);
  });
}

test('unavailable transport and secret reader return sanitized fail-closed errors', async () => {
  await rejects(createCoreCredentialVerifier({ readCredential: reader,
    fetchImpl: async () => { throw new Error('sensitive request'); } })('fixture', bbb), 'CORE_INTROSPECTION_UNAVAILABLE', 503);
  await rejects(createCoreCredentialVerifier({ readCredential: () => { throw new Error('sensitive secret'); } })('fixture', bbb), 'CORE_SERVICE_CREDENTIAL_INVALID', 503);
});

test('active true with altered binding, expired subject, wrong session or preview is denied', async () => {
  for (const field of ['personId', 'meetingId', 'role', 'kind']) {
    const result = active(); result.data.subject[field] = 'other';
    const verify = createCoreCredentialVerifier({ clock: () => now, readCredential: reader, fetchImpl: async () => Response.json(result) });
    await rejects(verify('fixture', bbb), 'CORE_IDENTITY_BINDING_MISMATCH', 403);
  }
  const cases = [
    [r => { r.data.subject.expiresAt = new Date(now * 1000).toISOString(); }, 'CORE_IDENTITY_EXPIRED', 403],
    [r => { r.data.subject.expiresAt = 'invalid'; }, 'CORE_EXPIRY_INVALID', 403],
    [r => { r.data.session.provider = 'other'; }, 'CORE_SESSION_INVALID', 403],
    [r => { r.data.session.status = 'ended'; }, 'CORE_SESSION_INVALID', 403],
    [r => { r.meta.preview = true; }, 'CORE_INTROSPECTION_RESPONSE_INVALID', 503],
    [r => { r.data.active = 'true'; }, 'CORE_INTROSPECTION_RESPONSE_INVALID', 503],
  ];
  for (const [change, code, status] of cases) {
    const result = active(); change(result);
    await rejects(createCoreCredentialVerifier({ clock: () => now, readCredential: reader,
      fetchImpl: async () => Response.json(result) })('fixture', bbb), code, status);
  }
  await rejects(createCoreCredentialVerifier({ readCredential: reader,
    fetchImpl: async () => new Response('invalid-json') })('fixture', bbb), 'CORE_INTROSPECTION_RESPONSE_INVALID', 503);
});

test('invalid BBB identity fails before secret access or Core request', async () => {
  let called = false;
  const verify = createCoreCredentialVerifier({ readCredential: () => { called = true; return reader(); } });
  await rejects(verify('fixture', { ...bbb, online: false }), 'BBB_PROOF_INVALID', 401);
  await rejects(verify('fixture', { ...bbb, extId: '' }), 'BBB_PROOF_INVALID', 401);
  assert.equal(called, false);
});

test('identity service passes immutable authenticated BBB bindings and preserves service failure status', async () => {
  const fixture = await createIdentityFixture();
  let calls = 0;
  const service = await createIdentityService({ ...fixture.options, verifyCoreCredential: async (token, verified) => {
    calls += 1; assert.equal(Object.isFrozen(verified), true);
    assert.equal(verified.extId, fixture.bbb.get(fixture.proofs.teacher.sessionToken).extId);
    assert.equal(token, fixture.proofs.teacher.coreToken);
    throw new (require('../server/identity-service.cjs').ContractError)('CORE_SERVICE_AUTH_FAILED', 503);
  } });
  await rejects(service.identify(fixture.proofs.teacher, {}), 'CORE_SERVICE_AUTH_FAILED', 503);
  fixture.bbb.get(fixture.proofs.teacher.sessionToken).online = false;
  await rejects(service.identify(fixture.proofs.teacher, {}), 'BBB_PROOF_INVALID', 401);
  assert.equal(calls, 1);
});

test('real introspection provider composes teacher/student issuance, misuse denial and reconnect with mock Core transport', async () => {
  const fixture = await createIdentityFixture();
  let calls = 0;
  const verifier = createCoreCredentialVerifier({ clock: () => fixture.time, readCredential: reader,
    fetchImpl: async (_url, options) => {
      calls += 1;
      const body = JSON.parse(options.body);
      const subject = fixture.core.get(body.token);
      if (!subject || subject.personId !== body.expected.personId) {
        return Response.json({ data: { active: false, mismatches: ['personId'] } });
      }
      const result = active({ ...bbb, extId: subject.personId, externalMeetingId: subject.meetingId,
        moderator: subject.role === 'teacher' });
      result.data.subject.expiresAt = new Date((fixture.time + 120) * 1000).toISOString();
      result.data.session.teacherPersonId = '17';
      return Response.json(result);
    } });
  const service = await createIdentityService({ ...fixture.options, coreIssuer: CORE_ISSUER, verifyCoreCredential: verifier });
  assert.equal((await service.identify(fixture.proofs.teacher, {})).identity.role, 'teacher');
  const ctx = await service.createContext(fixture.proofs.teacher, { activityId: 'fixture-live-one' });
  const a = await service.issueIdentity(fixture.proofs.studentA, { contextId: ctx.context.id });
  const b = await service.issueIdentity(fixture.proofs.studentB, { contextId: ctx.context.id });
  assert.notEqual(a.identity.corePersonId, b.identity.corePersonId);
  await rejects(service.issueIdentity({ ...fixture.proofs.studentA, coreToken: fixture.proofs.studentB.coreToken },
    { contextId: ctx.context.id }), 'CORE_IDENTITY_INACTIVE', 403);
  await rejects(service.createContext(fixture.proofs.studentA, { activityId: 'fixture-live-one' }), 'TEACHER_REQUIRED', 403);
  const reconnected = await service.issueIdentity(fixture.proofs.reconnectA, { contextId: ctx.context.id });
  assert.equal(a.identity.activityParticipantId, reconnected.identity.activityParticipantId);
  assert.notEqual(a.identity.bbbParticipantId, reconnected.identity.bbbParticipantId);
  assert.equal(calls, 7);
});

test('secret reader enforces regular non-symlink file, ownership, mode, size and protected directory', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgu-secret-reader-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.chmodSync(dir, 0o700);
  const file = path.join(dir, 'credential'); const link = path.join(dir, 'link');
  const uid = process.getuid(); const gid = process.getgid();
  fs.writeFileSync(file, Buffer.alloc(64, 120), { mode: 0o600 });
  assert.equal(readSecretFile(file, uid, gid).length, 64);
  fs.symlinkSync(file, link); assert.throws(() => readSecretFile(link, uid, gid));
  assert.throws(() => readSecretFile(file, uid + 1, gid));
  fs.chmodSync(file, 0o644); assert.throws(() => readSecretFile(file, uid, gid)); fs.chmodSync(file, 0o600);
  fs.writeFileSync(file, Buffer.alloc(63, 120)); assert.throws(() => readSecretFile(file, uid, gid));
  fs.writeFileSync(file, Buffer.alloc(64, 10)); assert.throws(() => readSecretFile(file, uid, gid));
  fs.chmodSync(dir, 0o755); assert.throws(() => readSecretFile(file, uid, gid));
});