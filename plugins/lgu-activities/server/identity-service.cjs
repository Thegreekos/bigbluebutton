const { createHash, randomUUID } = require('node:crypto');

class ContractError extends Error {
  constructor(code, status = 403) { super(code); this.code = code; this.status = status; }
}
function requireValue(condition, code, status) {
  if (!condition) throw new ContractError(code, status);
}
function stableId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && value.trim() === value && !/[\u0000-\u001f]/.test(value);
}
function coreId(value) {
  if (stableId(value)) return value;
  return Number.isSafeInteger(value) ? String(value) : null;
}
function exactBody(body, keys) {
  requireValue(body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).length === keys.length
    && keys.every((key) => Object.hasOwn(body, key) && stableId(body[key])), 'INVALID_BODY', 400);
}
function normalizeClassroom(response) {
  const data = response?.data;
  requireValue(data && typeof data === 'object' && !Array.isArray(data), 'CORE_SCOPE_INVALID');
  requireValue(data.mode !== 'adhoc_test', 'TEST_CONTEXT_DENIED');
  const teacherId = coreId(data.teacher?.personId);
  requireValue(stableId(data.meetingId) && teacherId
    && Array.isArray(data.students), 'CORE_SCOPE_INVALID');
  const students = data.students.map((student) => ({ personId: coreId(student?.studentId) }));
  requireValue(students.every((student) => stableId(student.personId))
    && new Set(students.map((student) => student.personId)).size === students.length
    && !students.some((student) => student.personId === teacherId), 'CORE_ROSTER_INVALID');
  return { meetingId: data.meetingId, teacher: { personId: teacherId }, students };
}

async function createIdentityService(options) {
  const { verifyBbbProof, verifyCoreCredential, readClassroom, resolveActivity,
    privateKey, publicKey, issuer, audience, coreIssuer, kid } = options;
  for (const fn of [verifyBbbProof, verifyCoreCredential, readClassroom, resolveActivity]) {
    if (typeof fn !== 'function') throw new TypeError('Trusted providers are required');
  }
  if (![issuer, audience, coreIssuer, kid].every(stableId) || !privateKey || !publicKey) {
    throw new TypeError('Explicit signing keys/issuer/audience/coreIssuer/kid are required');
  }
  const { SignJWT, jwtVerify } = await import('jose');
  const clock = options.clock || (() => Math.floor(Date.now() / 1000));
  const contexts = new Map();
  const contextKeys = new Map();
  const maxContexts = options.maxContexts || 1000;
  const clean = () => {
    for (const [id, context] of contexts) {
      if (context.expiresAt <= clock()) { contexts.delete(id); contextKeys.delete(context.key); }
    }
  };

  async function authenticate(proof) {
    requireValue(typeof proof?.sessionToken === 'string' && proof.sessionToken.length > 0
      && proof.sessionToken.length <= 8192, 'PROOF_REQUIRED', 401);
    let bbb;
    let core;
    try {
      bbb = await verifyBbbProof({ sessionToken: proof.sessionToken, cookie: proof.cookie });
    } catch { throw new ContractError('PROOF_INVALID', 401); }
    requireValue(bbb?.online === true && [bbb.meetingId, bbb.externalMeetingId, bbb.participantId].every(stableId)
      && typeof bbb.moderator === 'boolean', 'BBB_PROOF_INVALID', 401);
    // Only a validated BBB server response may supply expected Core bindings.
    // Immutable snapshot: never pass browser body assertions to introspection.
    bbb = Object.freeze({ ...bbb });
    const hasCredential = proof.coreToken !== undefined && proof.coreToken !== null;
    if (!hasCredential) return { bbb, core: null, mode: 'guest', organiser: bbb.moderator,
      principalId: principal(['guest', issuer, bbb.meetingId, bbb.participantId]) };
    requireValue(typeof proof.coreToken === 'string' && proof.coreToken.length > 0
      && proof.coreToken.length <= 8192 && stableId(bbb.extId), 'CORE_PROOF_INVALID', 401);
    try {
      core = await verifyCoreCredential(proof.coreToken, bbb);
    } catch (error) {
      if (error instanceof ContractError) throw error;
      throw new ContractError('CORE_PROOF_INVALID', 401);
    }
    requireValue(core?.issuer === coreIssuer && stableId(core.personId)
      && core.membershipActive === true && Number.isSafeInteger(core.expiresAt)
      && core.expiresAt > clock(), 'CORE_PROOF_INVALID', 401);
    requireValue(core.personId === bbb.extId && core.meetingId === bbb.externalMeetingId
      && core.participantId === bbb.participantId, 'IDENTITY_BINDING_MISMATCH');
    requireValue(['teacher', 'student'].includes(core.role), 'ROLE_MISMATCH');
    return { bbb, core, mode: 'core', organiser: bbb.moderator,
      principalId: principal(['core', coreIssuer, core.personId]) };
  }
  function principal(parts) { return `lgu-identity:${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`; }
  function selfIdentity(auth) {
    return { mode: auth.mode, principalId: auth.principalId,
      personId: auth.core?.personId ?? null, corePersonId: auth.core?.personId ?? null,
      coreIssuer: auth.core ? coreIssuer : null, role: auth.core?.role ?? 'guest',
      organiser: auth.organiser, persistentHistoryEligible: auth.mode === 'core',
      meetingId: auth.bbb.meetingId, participantId: auth.bbb.participantId };
  }
  async function enrichment(auth, coreToken) {
    if (!auth.core) return { classroom: null, learningContext: null, enrichmentStatus: 'not-applicable' };
    try {
      const raw = await readClassroom(coreToken);
      const classroom = normalizeCoreContextForEnrichment(raw, auth);
      const own = auth.core.role === 'student'
        ? raw.data.students?.find(s => coreId(s.studentId) === auth.core.personId) : raw.data.context;
      const value = v => typeof v === 'string' ? v : typeof v?.value === 'string' ? v.value : null;
      return { classroom, learningContext: { level: value(own?.currentLevel ?? own?.level),
        unit: value(own?.currentUnit ?? own?.unit), book: value(own?.book) }, enrichmentStatus: 'available' };
    } catch { return { classroom: null, learningContext: null, enrichmentStatus: 'unavailable' }; }
  }
  function normalizeCoreContextForEnrichment(raw, auth) {
    const classroom = normalizeClassroom(raw);
    requireValue(classroom.meetingId === auth.bbb.externalMeetingId, 'CLASSROOM_BINDING_MISMATCH');
    if (auth.core.role === 'teacher') {
      requireValue(classroom.teacher.personId === auth.core.personId, 'CLASSROOM_BINDING_MISMATCH');
      return classroom;
    }
    requireValue(classroom.students.some(s => s.personId === auth.core.personId), 'CONTEXT_MEMBERSHIP_DENIED');
    return null; // Never expose roster to a student.
  }
  async function teacherClassroom(auth, coreToken) {
    requireValue(auth.organiser === true, 'TEACHER_REQUIRED');
    return enrichment(auth, coreToken);
  }
  function publicContext(context, auth) {
    return { id: context.id, activityId: context.activityId, lguSessionId: null,
      meetingId: context.meetingId, externalMeetingId: context.externalMeetingId,
      expiresAt: context.expiresAt,
      organiserSelected: true,
      ...(auth.organiser && context.classroom ? structuredClone({ teacher: context.classroom.teacher, students: context.classroom.students }) : {}) };
  }
  function authorizedContext(auth, id) {
    clean();
    const context = contexts.get(id);
    requireValue(context, 'CONTEXT_NOT_FOUND', 404);
    requireValue(context.meetingId === auth.bbb.meetingId
      && context.externalMeetingId === auth.bbb.externalMeetingId, 'CONTEXT_MEETING_MISMATCH');
    // Authenticated online meeting participants may join the organiser's activity.
    // Core enrollment was verified by introspection; guests never inherit its IDs.
    if (auth.organiser) requireValue(context.organiserId === auth.principalId, 'CONTEXT_MEMBERSHIP_DENIED');
    return context;
  }
  function activitySubject(auth, context) {
    return `activity-person:${createHash('sha256').update(JSON.stringify([context.id, auth.principalId])).digest('hex')}`;
  }
  async function issue(auth, context) {
    const now = clock();
    const exp = Math.min(now + 120, auth.core?.expiresAt ?? now + 120, context.expiresAt);
    requireValue(exp > now, 'IDENTITY_EXPIRED', 401);
    const identity = { v: 2, mode: auth.mode, principalId: auth.principalId, organiser: auth.organiser,
      persistentHistoryEligible: auth.mode === 'core', coreIssuer: auth.core ? coreIssuer : null,
      corePersonId: auth.core?.personId ?? null, role: auth.core?.role ?? 'guest',
      scope: auth.organiser ? 'context:prepare' : 'activity:participate',
      bbbMeetingId: auth.bbb.meetingId, bbbExternalMeetingId: auth.bbb.externalMeetingId,
      bbbParticipantId: auth.bbb.participantId, activityId: context.activityId,
      contextId: context.id, lguSessionId: null };
    const identityToken = await new SignJWT(identity)
      .setProtectedHeader({ alg: 'EdDSA', typ: 'lgu-activity-identity+jwt', kid })
      .setIssuer(issuer).setAudience(audience).setSubject(activitySubject(auth, context))
      .setIssuedAt(now).setNotBefore(now).setExpirationTime(exp).setJti(randomUUID()).sign(privateKey);
    return { context: publicContext(context, auth), identity: { ...identity, activityParticipantId: activitySubject(auth, context) },
      identityToken, expiresAt: exp };
  }

  return {
    async identifySelf(proof, body) {
      exactBody(body, []);
      const auth = await authenticate(proof);
      const extra = await enrichment(auth, proof.coreToken);
      return { identity: selfIdentity(auth),
        learningContext: extra.learningContext, enrichmentStatus: extra.enrichmentStatus,
        expiresAt: Math.min(clock() + 120, auth.core?.expiresAt ?? clock() + 120) };
    },
    async identify(proof, body) {
      exactBody(body, []);
      const auth = await authenticate(proof);
      const extra = await teacherClassroom(auth, proof.coreToken);
      return { identity: selfIdentity(auth), ...extra,
      expiresAt: Math.min(clock() + 120, auth.core?.expiresAt ?? clock() + 120) };
    },
    async createContext(proof, body) {
      exactBody(body, ['activityId']);
      const auth = await authenticate(proof);
      const extra = await teacherClassroom(auth, proof.coreToken);
      requireValue(await resolveActivity(body.activityId) === true, 'ACTIVITY_NOT_ALLOWED');
      clean();
      const key = JSON.stringify([auth.bbb.meetingId, auth.principalId, body.activityId]);
      let context = contexts.get(contextKeys.get(key));
      if (context) {
        // Never extend lifetime; refresh authoritative roster on repeated preparation.
        context.classroom = extra.classroom;
      } else {
        requireValue(contexts.size < maxContexts, 'CONTEXT_CAPACITY', 503);
        context = { id: randomUUID(), key, meetingId: auth.bbb.meetingId,
          externalMeetingId: auth.bbb.externalMeetingId, activityId: body.activityId, classroom: extra.classroom,
          organiserId: auth.principalId, expiresAt: Math.min(clock() + 300, auth.core?.expiresAt ?? clock() + 300) };
        contexts.set(context.id, context); contextKeys.set(key, context.id);
      }
      return issue(auth, context);
    },
    async issueIdentity(proof, body) {
      exactBody(body, ['contextId']);
      const auth = await authenticate(proof);
      return issue(auth, authorizedContext(auth, body.contextId));
    },
    async verifyIdentity(proof, body) {
      // JWT can exceed the stable-ID length; never treat its contents as client identity.
      requireValue(body && !Array.isArray(body) && Object.keys(body).length === 2 && Object.hasOwn(body, 'contextId') && stableId(body.contextId)
        && typeof body.identityToken === 'string' && body.identityToken.length <= 8192
        && Object.hasOwn(body, 'identityToken'), 'INVALID_BODY', 400);
      const auth = await authenticate(proof);
      const context = authorizedContext(auth, body.contextId);
      let verified;
      try {
        verified = await jwtVerify(body.identityToken, publicKey, {
          algorithms: ['EdDSA'], issuer, audience, typ: 'lgu-activity-identity+jwt',
          currentDate: new Date(clock() * 1000), requiredClaims: ['iat', 'nbf', 'exp', 'jti', 'sub'],
        });
      } catch { throw new ContractError('ACTIVITY_TOKEN_INVALID', 401); }
      const p = verified.payload;
      requireValue(verified.protectedHeader.kid === kid && p.v === 2 && p.aud === audience
        && Number.isSafeInteger(p.iat) && Number.isSafeInteger(p.exp) && p.iat <= clock()
        && Number.isSafeInteger(p.nbf) && p.nbf <= clock() && p.coreIssuer === (auth.core ? coreIssuer : null)
        && p.exp - p.iat <= 120 && p.exp <= (auth.core?.expiresAt ?? clock() + 120) && p.exp <= context.expiresAt
        && p.sub === activitySubject(auth, context) && p.corePersonId === (auth.core?.personId ?? null)
        && p.mode === auth.mode && p.principalId === auth.principalId && p.organiser === auth.organiser
        && p.persistentHistoryEligible === (auth.mode === 'core')
        && p.role === (auth.core?.role ?? 'guest') && p.bbbMeetingId === auth.bbb.meetingId
        && p.bbbExternalMeetingId === auth.bbb.externalMeetingId && p.bbbParticipantId === auth.bbb.participantId
        && p.activityId === context.activityId && p.contextId === context.id && p.lguSessionId === null
        && p.scope === (auth.organiser ? 'context:prepare' : 'activity:participate'), 'ACTIVITY_BINDING_MISMATCH');
      return { identity: { activityParticipantId: p.sub, corePersonId: p.corePersonId,
        coreIssuer: p.coreIssuer, mode: p.mode, organiser: p.organiser, principalId: p.principalId,
        persistentHistoryEligible: p.persistentHistoryEligible, role: p.role, contextId: p.contextId,
        activityId: p.activityId, participantId: p.bbbParticipantId }, expiresAt: p.exp };
    },
  };
}

module.exports = { ContractError, createIdentityService, normalizeClassroom };