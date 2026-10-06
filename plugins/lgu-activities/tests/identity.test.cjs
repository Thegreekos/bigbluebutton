const test = require('node:test');
const assert = require('node:assert/strict');
const { createIdentityFixture } = require('./fixtures/identity-fixture.cjs');
const { createIdentityService } = require('../server/identity-service.cjs');
const rejected = (promise, code) => assert.rejects(promise, (error) => error.code === code);
const prepare = (fixture, proof = fixture.proofs.teacher) => fixture.service.createContext(proof, { activityId: 'fixture-live-one' });

test('synthetic canonical teacher identified via matching BBB and Core proofs, not name', async () => {
  const f = await createIdentityFixture();
  const result = await f.service.identify(f.proofs.teacher, {});
  assert.equal(result.identity.personId, '17');
  assert.equal(result.identity.role, 'teacher');
  assert.deepEqual(result.classroom.students.map((s) => s.personId), ['29', '31']);
});

test('teacher prepares context only, activity token has bounded claims and no LGU session', async () => {
  const f = await createIdentityFixture();
  const result = await prepare(f);
  const { jwtVerify } = await import('jose');
  const { payload, protectedHeader } = await jwtVerify(result.identityToken, f.options.publicKey);
  assert.equal(protectedHeader.alg, 'EdDSA');
  assert.equal(payload.bbbParticipantId, 'w_teacher');
  assert.equal(payload.bbbMeetingId, 'fixture-internal-meeting');
  assert.equal(payload.bbbExternalMeetingId, 'fixture-lesson');
  assert.equal(payload.corePersonId, '17');
  assert.equal(payload.role, 'teacher');
  assert.equal(payload.scope, 'context:prepare');
  assert.equal(payload.exp - payload.iat, 120);
  assert.equal(payload.contextId, result.context.id);
  assert.equal(payload.activityId, 'fixture-live-one');
  assert.equal(payload.lguSessionId, null);
  assert.equal((await prepare(f)).context.id, result.context.id);
});

test('student receives only its own stable identity and another student cannot use its token', async () => {
  const f = await createIdentityFixture();
  const ctx = await prepare(f);
  const a = await f.service.issueIdentity(f.proofs.studentA, { contextId: ctx.context.id });
  assert.equal(a.identity.corePersonId, '29');
  assert.equal(a.identity.scope, 'activity:participate');
  assert.equal((await f.service.verifyIdentity(f.proofs.studentA, { contextId: ctx.context.id, identityToken: a.identityToken })).identity.corePersonId, '29');
  await rejected(f.service.verifyIdentity(f.proofs.studentB, { contextId: ctx.context.id, identityToken: a.identityToken }), 'ACTIVITY_BINDING_MISMATCH');
  await rejected(f.service.issueIdentity({ ...f.proofs.studentB, coreToken: f.proofs.studentA.coreToken }, { contextId: ctx.context.id }), 'IDENTITY_BINDING_MISMATCH');
});

test('browser identity/role/meeting assertions and teacher minting for students are rejected', async () => {
  const f = await createIdentityFixture();
  const ctx = await prepare(f);
  for (const field of ['personId', 'studentId', 'role', 'meetingId', 'participantId']) {
    await rejected(f.service.issueIdentity(f.proofs.teacher, { contextId: ctx.context.id, [field]: '29' }), 'INVALID_BODY');
  }
  await rejected(f.service.createContext(f.proofs.teacher, { activityId: 'fixture-live-one', role: 'teacher' }), 'INVALID_BODY');
});

test('viewer/student gains no teacher authority, even when BBB role alone is elevated', async () => {
  const f = await createIdentityFixture();
  await rejected(prepare(f, f.proofs.studentA), 'TEACHER_REQUIRED');
  await rejected(prepare(f, f.proofs.viewerTeacher), 'ROLE_MISMATCH');
  f.bbb.get(f.proofs.studentA.sessionToken).moderator = true;
  await rejected(prepare(f, f.proofs.studentA), 'ROLE_MISMATCH');
  await rejected(prepare(f, f.proofs.otherTeacher), 'CLASSROOM_BINDING_MISMATCH');
});

test('unknown/guest/missing Core credential and test room fail closed', async () => {
  const f = await createIdentityFixture();
  const ctx = await prepare(f);
  await rejected(f.service.issueIdentity(f.proofs.guest, { contextId: ctx.context.id }), 'BBB_PROOF_INVALID');
  await rejected(f.service.issueIdentity(f.proofs.stranger, { contextId: ctx.context.id }), 'CONTEXT_MEMBERSHIP_DENIED');
  await rejected(f.service.identify({ sessionToken: 'fixture-bbb-teacher' }, {}), 'PROOF_REQUIRED');
  f.setClassroom({ data: { mode: 'adhoc_test', meetingId: 'fixture-lesson', teacher: { personId: '17' }, students: [] } });
  await rejected(prepare(f), 'TEST_CONTEXT_DENIED');
});

test('reconnect changes participant binding but not canonical/activity identity', async () => {
  const f = await createIdentityFixture();
  const ctx = await prepare(f);
  const before = await f.service.issueIdentity(f.proofs.studentA, { contextId: ctx.context.id });
  const after = await f.service.issueIdentity(f.proofs.reconnectA, { contextId: ctx.context.id });
  assert.equal(before.identity.activityParticipantId, after.identity.activityParticipantId);
  assert.equal(after.identity.corePersonId, '29');
  assert.notEqual(before.identity.bbbParticipantId, after.identity.bbbParticipantId);
  await rejected(f.service.verifyIdentity(f.proofs.reconnectA, { contextId: ctx.context.id, identityToken: before.identityToken }), 'ACTIVITY_BINDING_MISMATCH');
  assert.equal((await f.service.verifyIdentity(f.proofs.reconnectA, { contextId: ctx.context.id, identityToken: after.identityToken })).identity.corePersonId, '29');
});

test('expiry, offline session, revoked membership and changed role are revalidated', async () => {
  const f = await createIdentityFixture();
  const ctx = await prepare(f);
  const body = { contextId: ctx.context.id, identityToken: ctx.identityToken };
  f.setTime(f.time + 120);
  await rejected(f.service.verifyIdentity(f.proofs.teacher, body), 'ACTIVITY_TOKEN_INVALID');
  f.bbb.get(f.proofs.teacher.sessionToken).online = false;
  await rejected(f.service.verifyIdentity(f.proofs.teacher, body), 'BBB_PROOF_INVALID');
  f.bbb.get(f.proofs.teacher.sessionToken).online = true;
  f.core.get(f.proofs.teacher.coreToken).membershipActive = false;
  await rejected(f.service.verifyIdentity(f.proofs.teacher, body), 'CORE_PROOF_INVALID');
  f.core.get(f.proofs.teacher.coreToken).membershipActive = true;
  f.bbb.get(f.proofs.teacher.sessionToken).moderator = false;
  await rejected(f.service.verifyIdentity(f.proofs.teacher, body), 'ROLE_MISMATCH');
});

test('new meeting incarnation and expired context cannot reuse activity identity', async () => {
  const f = await createIdentityFixture();
  const ctx = await prepare(f);
  f.bbb.get(f.proofs.studentA.sessionToken).meetingId = 'other-internal-incarnation';
  await rejected(f.service.issueIdentity(f.proofs.studentA, { contextId: ctx.context.id }), 'CONTEXT_MEETING_MISMATCH');
  f.setTime(f.time + 300);
  await rejected(f.service.issueIdentity(f.proofs.teacher, { contextId: ctx.context.id }), 'CONTEXT_NOT_FOUND');
  assert.notEqual((await prepare(f)).context.id, ctx.context.id);
});

test('token signature tampering and wrong issuer/audience/activity/scope are denied', async () => {
  const f = await createIdentityFixture();
  const ctx = await prepare(f);
  const { decodeJwt, SignJWT } = await import('jose');
  const payload = decodeJwt(ctx.identityToken);
  await rejected(f.service.verifyIdentity(f.proofs.teacher, { contextId: ctx.context.id,
    identityToken: `${ctx.identityToken.slice(0, -8)}invalidX` }), 'ACTIVITY_TOKEN_INVALID');
  for (const override of [{ aud: 'lgu-backend' }, { iss: 'other' }, { activityId: 'other' },
    { scope: 'activity:participate' }, { exp: payload.iat + 121 }, { iat: payload.iat + 60 },
    { nbf: payload.iat + 60 }, { lguSessionId: 'invented-session' }, { coreIssuer: 'other-core' }]) {
    const token = await new SignJWT({ ...payload, ...override })
      .setProtectedHeader({ alg: 'EdDSA', typ: 'lgu-activity-identity+jwt', kid: f.options.kid }).sign(f.options.privateKey);
    await assert.rejects(f.service.verifyIdentity(f.proofs.teacher, { contextId: ctx.context.id, identityToken: token }));
  }
});

test('duplicate roster IDs, absent meeting binding, unknown activity and missing providers fail closed', async () => {
  const f = await createIdentityFixture();
  await rejected(f.service.createContext(f.proofs.teacher, { activityId: 'arbitrary' }), 'ACTIVITY_NOT_ALLOWED');
  f.setClassroom({ data: { teacher: { personId: '17' }, students: [] } });
  await rejected(prepare(f), 'CORE_SCOPE_INVALID');
  f.setClassroom({ data: { meetingId: 'fixture-lesson', teacher: { personId: '17' }, students: [{ studentId: '29' }, { studentId: '29' }] } });
  await rejected(prepare(f), 'CORE_ROSTER_INVALID');
  await assert.rejects(createIdentityService({ ...f.options, verifyCoreCredential: undefined }), /Trusted providers/);
});

test('student scope escalation, teacher token reuse by student and changed Core role are rejected', async () => {
  const f = await createIdentityFixture();
  const ctx = await prepare(f);
  const student = await f.service.issueIdentity(f.proofs.studentA, { contextId: ctx.context.id });
  await rejected(f.service.verifyIdentity(f.proofs.studentA, { contextId: ctx.context.id, identityToken: ctx.identityToken }), 'ACTIVITY_BINDING_MISMATCH');
  const { decodeJwt, SignJWT } = await import('jose');
  const token = await new SignJWT({ ...decodeJwt(student.identityToken), scope: 'context:prepare', role: 'teacher' })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'lgu-activity-identity+jwt', kid: f.options.kid }).sign(f.options.privateKey);
  await rejected(f.service.verifyIdentity(f.proofs.studentA, { contextId: ctx.context.id, identityToken: token }), 'ACTIVITY_BINDING_MISMATCH');
  f.core.get(f.proofs.teacher.coreToken).role = 'student';
  f.bbb.get(f.proofs.teacher.sessionToken).moderator = false;
  await rejected(f.service.verifyIdentity(f.proofs.teacher, { contextId: ctx.context.id, identityToken: ctx.identityToken }), 'CONTEXT_MEMBERSHIP_DENIED');
});

test('JWT lifetime clips to Core credential expiry and rejects expired Core proof', async () => {
  const f = await createIdentityFixture();
  f.core.get(f.proofs.teacher.coreToken).expiresAt = f.time + 15;
  const ctx = await prepare(f);
  assert.equal(ctx.expiresAt, f.time + 15);
  assert.equal(ctx.context.expiresAt, f.time + 15);
  f.setTime(f.time + 15);
  await rejected(f.service.identify(f.proofs.teacher, {}), 'CORE_PROOF_INVALID');
});

test('read-only verification is repeatable by same authenticated caller, not an action redemption', async () => {
  const f = await createIdentityFixture();
  const ctx = await prepare(f);
  const body = { contextId: ctx.context.id, identityToken: ctx.identityToken };
  const first = await f.service.verifyIdentity(f.proofs.teacher, body);
  const second = await f.service.verifyIdentity(f.proofs.teacher, body);
  assert.deepEqual(first, second);
});

test('Core IDs reject coercible objects and unsafe numeric identity values', async () => {
  const f = await createIdentityFixture();
  for (const id of [{ id: '29' }, ['29'], Number.MAX_SAFE_INTEGER + 1, '', ' 29']) {
    f.setClassroom({ data: { meetingId: 'fixture-lesson', teacher: { personId: '17' }, students: [{ studentId: id }] } });
    await rejected(prepare(f), 'CORE_ROSTER_INVALID');
  }
});