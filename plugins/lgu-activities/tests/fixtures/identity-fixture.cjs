// SYNTHETIC ONLY. No unverified JWT decoding or browser-selected identity.
// These registries stand in for authoritative server-side BBB/Core validation.
const { generateKeyPairSync } = require('node:crypto');
const { createIdentityService } = require('../../server/identity-service.cjs');

async function createIdentityFixture() {
  let now = Math.floor(Date.now() / 1000);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const bbb = new Map();
  const core = new Map();
  const proofs = {};
  function register(name, personId, participantId, role, extra = {}) {
    proofs[name] = { sessionToken: `fixture-bbb-${name}`, coreToken: `fixture-core-${name}`, cookie: 'fixture-bbb-session=1' };
    bbb.set(proofs[name].sessionToken, { meetingId: 'fixture-internal-meeting', externalMeetingId: 'fixture-lesson',
      participantId, extId: personId, moderator: role === 'teacher', online: true, ...extra.bbb });
    core.set(proofs[name].coreToken, { issuer: 'fixture-school-core', personId, role,
      participantId, meetingId: 'fixture-lesson', expiresAt: now + 3600, membershipActive: true, ...extra.core });
  }
  register('teacher', '17', 'w_teacher', 'teacher');
  register('studentA', '29', 'w_student_a', 'student');
  register('studentB', '31', 'w_student_b', 'student');
  register('reconnectA', '29', 'w_student_a_reconnected', 'student');
  register('stranger', '99', 'w_stranger', 'student');
  register('guest', '', 'w_guest', 'student');
  register('viewerTeacher', '17', 'w_viewer_teacher', 'teacher', { bbb: { moderator: false } });
  register('otherTeacher', '19', 'w_other_teacher', 'teacher');
  let classroom = { data: { meetingId: 'fixture-lesson', teacher: { personId: '17' },
    students: [{ studentId: '29', studentName: 'Same display name' }, { studentId: '31', studentName: 'Same display name' }] } };
  const options = { privateKey, publicKey, issuer: 'fixture-activity-adapter', audience: 'fixture-activity-adapter-v1',
    coreIssuer: 'fixture-school-core', kid: 'fixture-ephemeral-key', clock: () => now,
    async verifyBbbProof(proof) {
      if (proof.cookie !== 'fixture-bbb-session=1' || !bbb.has(proof.sessionToken)) throw new Error('invalid proof');
      return structuredClone(bbb.get(proof.sessionToken));
    },
    async verifyCoreCredential(token) {
      if (!core.has(token)) throw new Error('invalid proof');
      return structuredClone(core.get(token));
    },
    async readClassroom() { return structuredClone(classroom); },
    async resolveActivity(id) { return id === 'fixture-live-one'; },
  };
  return { service: await createIdentityService(options), options, bbb, core, proofs,
    setTime(value) { now = value; }, get time() { return now; },
    setClassroom(value) { classroom = value; } };
}
module.exports = { createIdentityFixture };