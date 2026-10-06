const test = require('node:test');
const assert = require('node:assert/strict');
const { createIdentityFixture } = require('./fixtures/identity-fixture.cjs');
const { createIdentityService } = require('../server/identity-service.cjs');
const { createHash } = require('node:crypto');
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

test('BBB organiser authority is independent of Core teacher/student association', async () => {
  const f = await createIdentityFixture();
  await rejected(prepare(f, f.proofs.studentA), 'TEACHER_REQUIRED');
  await rejected(prepare(f, f.proofs.viewerTeacher), 'TEACHER_REQUIRED');
  const viewer = await f.service.identifySelf(f.proofs.viewerTeacher, {});
  assert.equal(viewer.identity.role, 'teacher');
  assert.equal(viewer.identity.organiser, false);
  f.bbb.get(f.proofs.studentA.sessionToken).moderator = true;
  const promoted = await prepare(f, f.proofs.studentA);
  assert.equal(promoted.identity.role, 'student');
  assert.equal(promoted.identity.organiser, true);
  assert.equal(promoted.identity.scope, 'context:prepare');
  assert.equal(promoted.context.students, undefined);
  const other = await prepare(f, f.proofs.otherTeacher);
  assert.equal(other.identity.organiser, true);
  assert.equal(other.context.students, undefined);
});

test('same-meeting guests and introspected members join without optional roster gating', async () => {
  const f = await createIdentityFixture();
  const ctx = await prepare(f);
  for (const name of ['guest', 'stranger']) {
    const result = await f.service.issueIdentity(f.proofs[name], { contextId: ctx.context.id });
    assert.equal(result.identity.organiser, false);
    assert.equal(result.context.students, undefined);
    assert.equal(result.context.teacher, undefined);
    assert.equal(result.identity.corePersonId, name === 'guest' ? null : '99');
  }
  const guest = await f.service.identify({ ...f.proofs.teacher, coreToken: undefined }, {});
  assert.equal(guest.identity.mode, 'guest');
  assert.equal(guest.classroom, null);
  f.setClassroom({ data: { mode: 'adhoc_test', meetingId: 'fixture-lesson', teacher: { personId: '17' }, students: [] } });
  assert.equal((await f.service.identify(f.proofs.teacher, {})).enrichmentStatus, 'unavailable');
  assert.equal((await prepare(f)).context.students, undefined);
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
  f.setTime(f.time - 120);
  await rejected(f.service.verifyIdentity(f.proofs.teacher, body), 'ACTIVITY_BINDING_MISMATCH');
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

test('malformed enrichment is optional; unknown activity and missing providers fail closed', async () => {
  const f = await createIdentityFixture();
  await rejected(f.service.createContext(f.proofs.teacher, { activityId: 'arbitrary' }), 'ACTIVITY_NOT_ALLOWED');
  f.setClassroom({ data: { teacher: { personId: '17' }, students: [] } });
  assert.equal((await f.service.identify(f.proofs.teacher, {})).enrichmentStatus, 'unavailable');
  assert.equal((await prepare(f)).context.students, undefined);
  f.setClassroom({ data: { meetingId: 'fixture-lesson', teacher: { personId: '17' }, students: [{ studentId: '29' }, { studentId: '29' }] } });
  assert.equal((await f.service.identify(f.proofs.teacher, {})).enrichmentStatus, 'unavailable');
  assert.equal((await prepare(f)).context.students, undefined);
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
  await rejected(f.service.verifyIdentity(f.proofs.teacher, { contextId: ctx.context.id, identityToken: ctx.identityToken }), 'ACTIVITY_BINDING_MISMATCH');
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

test('malformed roster IDs are not exposed but do not revoke independent organiser authority', async () => {
  const f = await createIdentityFixture();
  for (const id of [{ id: '29' }, ['29'], Number.MAX_SAFE_INTEGER + 1, '', ' 29']) {
    f.setClassroom({ data: { meetingId: 'fixture-lesson', teacher: { personId: '17' }, students: [{ studentId: id }] } });
    const identity = await f.service.identify(f.proofs.teacher, {});
    assert.equal(identity.enrichmentStatus, 'unavailable');
    assert.equal(identity.classroom, null);
    assert.equal((await prepare(f)).context.students, undefined);
  }
});

test('guest moderator prepares a 300-second context and a 120-second v2 identity with explicit null Core IDs', async () => {
  const f = await createIdentityFixture();
  const self = await f.service.identifySelf(f.proofs.guestModerator, {});
  const expectedPrincipal = `lgu-identity:${createHash('sha256').update(JSON.stringify([
    'guest', f.options.issuer, 'fixture-internal-meeting', 'w_guest_moderator',
  ])).digest('hex')}`;
  assert.deepEqual(self.identity, { mode: 'guest', principalId: expectedPrincipal,
    personId: null, corePersonId: null, coreIssuer: null, role: 'guest', organiser: true,
    persistentHistoryEligible: false, meetingId: 'fixture-internal-meeting', participantId: 'w_guest_moderator' });
  assert.equal(self.classroom, undefined);
  assert.equal(self.learningContext, null);
  assert.equal(self.enrichmentStatus, 'not-applicable');
  const identified = await f.service.identify(f.proofs.guestModerator, {});
  assert.deepEqual(identified.identity, self.identity);
  assert.equal(identified.classroom, null);
  const ctx = await prepare(f, f.proofs.guestModerator);
  const { decodeJwt } = await import('jose');
  const p = decodeJwt(ctx.identityToken);
  assert.equal(ctx.context.expiresAt, f.time + 300);
  assert.equal(ctx.expiresAt, f.time + 120);
  assert.equal(ctx.context.organiserSelected, true);
  assert.equal(ctx.context.teacher, undefined);
  assert.equal(ctx.context.students, undefined);
  assert.equal(p.v, 2);
  for (const field of ['mode', 'principalId', 'organiser', 'persistentHistoryEligible', 'corePersonId', 'coreIssuer', 'role']) {
    assert.equal(p[field], self.identity[field]);
  }
  assert.equal(p.scope, 'context:prepare');
  assert.equal(p.sub, ctx.identity.activityParticipantId);
  assert.equal((await prepare(f, f.proofs.guestModerator)).context.id, ctx.context.id);
  f.setTime(f.time + 100);
  const renewed = await prepare(f, f.proofs.guestModerator);
  assert.equal(renewed.context.expiresAt, ctx.context.expiresAt);
  f.setTime(ctx.context.expiresAt - 10);
  assert.equal((await prepare(f, f.proofs.guestModerator)).expiresAt, ctx.context.expiresAt);
  f.setTime(ctx.context.expiresAt);
  await rejected(f.service.issueIdentity(f.proofs.guest, { contextId: ctx.context.id }), 'CONTEXT_NOT_FOUND');
  assert.notEqual((await prepare(f, f.proofs.guestModerator)).context.id, ctx.context.id);
  assert.equal(f.calls.core.length, 0);
  assert.equal(f.calls.classroom.length, 0);
});

test('guest viewer has own identity only and can join organiser context without inheriting Core IDs', async () => {
  const f = await createIdentityFixture();
  const self = await f.service.identifySelf(f.proofs.guest, {});
  assert.equal(self.identity.mode, 'guest');
  assert.equal(self.identity.role, 'guest');
  assert.equal(self.identity.organiser, false);
  assert.equal(self.identity.personId, null);
  assert.equal(self.identity.persistentHistoryEligible, false);
  assert.equal(self.classroom, undefined);
  await rejected(f.service.identify(f.proofs.guest, {}), 'TEACHER_REQUIRED');
  await rejected(prepare(f, f.proofs.guest), 'TEACHER_REQUIRED');
  const ctx = await prepare(f);
  const issued = await f.service.issueIdentity(f.proofs.guest, { contextId: ctx.context.id });
  assert.equal(issued.identity.scope, 'activity:participate');
  assert.equal(issued.identity.corePersonId, null);
  assert.equal(issued.identity.coreIssuer, null);
  assert.equal(issued.identity.principalId, self.identity.principalId);
  assert.equal(issued.context.students, undefined);
  assert.equal(issued.context.teacher, undefined);
  const body = { contextId: ctx.context.id, identityToken: issued.identityToken };
  assert.deepEqual(await f.service.verifyIdentity(f.proofs.guest, body), await f.service.verifyIdentity(f.proofs.guest, body));
});

test('absent Core credential includes undefined/null but supplied invalid credentials never fall back to guest', async () => {
  const f = await createIdentityFixture();
  for (const coreToken of [undefined, null]) {
    assert.equal((await f.service.identifySelf({ ...f.proofs.teacher, coreToken }, {})).identity.mode, 'guest');
  }
  for (const coreToken of ['', 'unknown-token', 0, {}, 'x'.repeat(8193)]) {
    await rejected(f.service.identifySelf({ ...f.proofs.teacher, coreToken }, {}), 'CORE_PROOF_INVALID');
    await rejected(prepare(f, { ...f.proofs.teacher, coreToken }), 'CORE_PROOF_INVALID');
  }
  await rejected(f.service.identifySelf({ ...f.proofs.guest, coreToken: f.proofs.teacher.coreToken }, {}), 'CORE_PROOF_INVALID');
  for (const [field, value, code] of [
    ['issuer', 'other-core', 'CORE_PROOF_INVALID'], ['personId', '', 'CORE_PROOF_INVALID'],
    ['membershipActive', false, 'CORE_PROOF_INVALID'], ['expiresAt', f.time, 'CORE_PROOF_INVALID'],
    ['personId', 'someone-else', 'IDENTITY_BINDING_MISMATCH'],
    ['meetingId', 'other-lesson', 'IDENTITY_BINDING_MISMATCH'],
    ['participantId', 'other-participant', 'IDENTITY_BINDING_MISMATCH'], ['role', 'admin', 'ROLE_MISMATCH'],
  ]) {
    const record = f.core.get(f.proofs.teacher.coreToken);
    const original = record[field]; record[field] = value;
    await rejected(f.service.identifySelf(f.proofs.teacher, {}), code);
    record[field] = original;
  }
});

test('guest authentication still requires online BBB proof and every meeting/participant binding', async () => {
  const f = await createIdentityFixture();
  await rejected(f.service.identifySelf({}, {}), 'PROOF_REQUIRED');
  await rejected(f.service.identifySelf({ ...f.proofs.guest, sessionToken: 'unknown' }, {}), 'PROOF_INVALID');
  await rejected(f.service.identifySelf({ ...f.proofs.guest, cookie: 'wrong' }, {}), 'PROOF_INVALID');
  const record = f.bbb.get(f.proofs.guest.sessionToken);
  for (const field of ['meetingId', 'externalMeetingId', 'participantId', 'online', 'moderator']) {
    const original = record[field];
    for (const value of [undefined, '', ' bad', field === 'online' ? false : null]) {
      record[field] = value;
      await rejected(f.service.identifySelf(f.proofs.guest, {}), 'BBB_PROOF_INVALID');
    }
    record[field] = original;
  }
  assert.equal(f.calls.core.length, 0);
});

test('guest context replay is denied across participants, meetings, external meetings and organiser principals', async () => {
  const f = await createIdentityFixture();
  const ctx = await prepare(f, f.proofs.guestModerator);
  const guest = await f.service.issueIdentity(f.proofs.guest, { contextId: ctx.context.id });
  const body = { contextId: ctx.context.id, identityToken: guest.identityToken };
  await rejected(f.service.verifyIdentity({ ...f.proofs.studentA, coreToken: undefined }, body), 'ACTIVITY_BINDING_MISMATCH');
  await rejected(f.service.issueIdentity({ ...f.proofs.teacher, coreToken: undefined }, { contextId: ctx.context.id }), 'CONTEXT_MEMBERSHIP_DENIED');
  const participant = f.bbb.get(f.proofs.guest.sessionToken);
  for (const field of ['meetingId', 'externalMeetingId']) {
    const original = participant[field]; participant[field] = 'other-meeting';
    await rejected(f.service.verifyIdentity(f.proofs.guest, body), 'CONTEXT_MEETING_MISMATCH');
    await rejected(f.service.issueIdentity(f.proofs.guest, { contextId: ctx.context.id }), 'CONTEXT_MEETING_MISMATCH');
    participant[field] = original;
  }
  participant.participantId = 'guest-reconnected';
  await rejected(f.service.verifyIdentity(f.proofs.guest, body), 'ACTIVITY_BINDING_MISMATCH');
  assert.notEqual((await f.service.identifySelf(f.proofs.guest, {})).identity.principalId, guest.identity.principalId);
  assert.equal((await f.service.issueIdentity(f.proofs.stranger, { contextId: ctx.context.id })).identity.corePersonId, '99');
  await rejected(f.service.createContext(f.proofs.guestModerator, { activityId: 'not-approved' }), 'ACTIVITY_NOT_ALLOWED');
});

test('v2 JWT binds mode, organiser, history, principal and nullable Core IDs in both modes', async () => {
  const { decodeJwt, SignJWT } = await import('jose');
  for (const name of ['teacher', 'guestModerator']) {
    const f = await createIdentityFixture();
    const proof = f.proofs[name];
    const ctx = await prepare(f, proof);
    const payload = decodeJwt(ctx.identityToken);
    const overrides = [
      { v: 1 }, { mode: name === 'teacher' ? 'guest' : 'core' }, { organiser: false },
      { persistentHistoryEligible: !payload.persistentHistoryEligible }, { principalId: 'forged-principal' },
      { corePersonId: name === 'teacher' ? null : '17' }, { coreIssuer: name === 'teacher' ? null : f.options.coreIssuer },
      { role: name === 'teacher' ? 'student' : 'teacher' }, { scope: 'activity:participate' },
      { sub: 'forged-subject' }, { bbbParticipantId: 'other' }, { bbbMeetingId: 'other' },
      { bbbExternalMeetingId: 'other' }, { contextId: 'other' }, { activityId: 'other' },
    ];
    for (const field of ['corePersonId', 'coreIssuer', 'mode', 'organiser', 'persistentHistoryEligible', 'principalId']) {
      const missing = { ...payload }; delete missing[field];
      const token = await new SignJWT(missing).setProtectedHeader({ alg: 'EdDSA', typ: 'lgu-activity-identity+jwt', kid: f.options.kid }).sign(f.options.privateKey);
      await rejected(f.service.verifyIdentity(proof, { contextId: ctx.context.id, identityToken: token }), 'ACTIVITY_BINDING_MISMATCH');
    }
    for (const override of overrides) {
      const token = await new SignJWT({ ...payload, ...override }).setProtectedHeader({ alg: 'EdDSA', typ: 'lgu-activity-identity+jwt', kid: f.options.kid }).sign(f.options.privateKey);
      await rejected(f.service.verifyIdentity(proof, { contextId: ctx.context.id, identityToken: token }), 'ACTIVITY_BINDING_MISMATCH');
    }
  }
});

test('verification rechecks both proofs and rejects changed Core association, BBB authority or mode', async () => {
  const f = await createIdentityFixture();
  const ctx = await prepare(f);
  const issued = await f.service.issueIdentity(f.proofs.studentA, { contextId: ctx.context.id });
  const body = { contextId: ctx.context.id, identityToken: issued.identityToken };
  const before = { bbb: f.calls.bbb.length, core: f.calls.core.length };
  await f.service.verifyIdentity(f.proofs.studentA, body);
  assert.equal(f.calls.bbb.length, before.bbb + 1);
  assert.equal(f.calls.core.length, before.core + 1);
  f.core.get(f.proofs.studentA.coreToken).role = 'teacher';
  await rejected(f.service.verifyIdentity(f.proofs.studentA, body), 'ACTIVITY_BINDING_MISMATCH');
  f.core.get(f.proofs.studentA.coreToken).role = 'student';
  f.core.get(f.proofs.studentA.coreToken).membershipActive = false;
  await rejected(f.service.verifyIdentity(f.proofs.studentA, body), 'CORE_PROOF_INVALID');
  f.core.get(f.proofs.studentA.coreToken).membershipActive = true;
  await rejected(f.service.verifyIdentity({ ...f.proofs.studentA, coreToken: undefined }, body), 'ACTIVITY_BINDING_MISMATCH');
  const guest = await f.service.issueIdentity({ ...f.proofs.studentA, coreToken: undefined }, { contextId: ctx.context.id });
  await rejected(f.service.verifyIdentity(f.proofs.studentA, { contextId: ctx.context.id, identityToken: guest.identityToken }), 'ACTIVITY_BINDING_MISMATCH');
  f.bbb.get(f.proofs.teacher.sessionToken).moderator = false;
  await rejected(f.service.verifyIdentity(f.proofs.teacher, { contextId: ctx.context.id, identityToken: ctx.identityToken }), 'ACTIVITY_BINDING_MISMATCH');
  f.bbb.get(f.proofs.studentA.sessionToken).online = false;
  await rejected(f.service.verifyIdentity(f.proofs.studentA, body), 'BBB_PROOF_INVALID');
});

test('Core principal persists across meetings while activity subject is context plus principal', async () => {
  const f = await createIdentityFixture();
  const firstContext = await prepare(f);
  const first = await f.service.issueIdentity(f.proofs.studentA, { contextId: firstContext.context.id });
  const principal = `lgu-identity:${createHash('sha256').update(JSON.stringify(['core', f.options.coreIssuer, '29'])).digest('hex')}`;
  assert.equal(first.identity.principalId, principal);
  assert.equal(first.identity.persistentHistoryEligible, true);
  const subject = `activity-person:${createHash('sha256').update(JSON.stringify([firstContext.context.id, principal])).digest('hex')}`;
  assert.equal(first.identity.activityParticipantId, subject);
  const guestBefore = await f.service.identifySelf(f.proofs.guest, {});
  for (const record of f.bbb.values()) { record.meetingId = 'new-incarnation'; record.externalMeetingId = 'new-lesson'; }
  for (const record of f.core.values()) record.meetingId = 'new-lesson';
  const secondContext = await prepare(f);
  const second = await f.service.issueIdentity(f.proofs.reconnectA, { contextId: secondContext.context.id });
  assert.equal(second.identity.principalId, principal);
  assert.notEqual(second.identity.activityParticipantId, first.identity.activityParticipantId);
  assert.notEqual(secondContext.context.id, firstContext.context.id);
  assert.notEqual((await f.service.identifySelf(f.proofs.guest, {})).identity.principalId, guestBefore.identity.principalId);
  const differentIssuer = await createIdentityService({ ...f.options, coreIssuer: 'another-core',
    verifyCoreCredential: async token => ({ ...f.core.get(token), issuer: 'another-core' }) });
  assert.notEqual((await differentIssuer.identifySelf(f.proofs.studentA, {})).identity.principalId, principal);
});

test('self exposes only own learning context; optional enrichment failure never grants or removes organiser authority', async () => {
  const f = await createIdentityFixture();
  f.setClassroom({ data: { meetingId: 'fixture-lesson', teacher: { personId: '17' },
    context: { level: 'teacher-level', unit: 'teacher-unit', book: 'teacher-book' },
    students: [{ studentId: '29', currentLevel: { value: 'own-level' }, currentUnit: 'own-unit', book: 'own-book' },
      { studentId: '31', currentLevel: 'private-other-level' }] } });
  const self = await f.service.identifySelf(f.proofs.studentA, {});
  assert.deepEqual(self.learningContext, { level: 'own-level', unit: 'own-unit', book: 'own-book' });
  assert.equal(self.classroom, undefined);
  assert.equal(self.identity.personId, '29');
  assert.equal(self.identity.organiser, false);
  assert.doesNotMatch(JSON.stringify(self), /private-other-level|teacher-book/);
  assert.equal((await f.service.identifySelf(f.proofs.teacher, {})).classroom, undefined);
  f.setClassroomError(new Error('private upstream failure'));
  const organiser = await f.service.identify(f.proofs.teacher, {});
  assert.equal(organiser.enrichmentStatus, 'unavailable');
  assert.equal(organiser.classroom, null);
  assert.equal(organiser.learningContext, null);
  assert.equal(organiser.identity.organiser, true);
  assert.doesNotMatch(JSON.stringify(organiser), /private upstream/);
  const ctx = await prepare(f);
  assert.equal(ctx.identity.scope, 'context:prepare');
  assert.equal(ctx.context.students, undefined);
  await rejected(f.service.identify(f.proofs.viewerTeacher, {}), 'TEACHER_REQUIRED');
  await rejected(prepare(f, f.proofs.viewerTeacher), 'TEACHER_REQUIRED');
  f.setClassroom({ data: { meetingId: 'fixture-lesson', teacher: { personId: '17' }, students: [] } });
  f.setClassroomError(null);
  const missingRoster = await f.service.identifySelf(f.proofs.studentA, {});
  assert.equal(missingRoster.enrichmentStatus, 'unavailable');
  assert.equal(missingRoster.identity.mode, 'core');
  assert.equal((await f.service.issueIdentity(f.proofs.studentA, { contextId: ctx.context.id })).identity.corePersonId, '29');
});