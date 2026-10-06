const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { ContractError } = require('./identity-service.cjs');

const SECRET_PATH = '/etc/bigbluebutton/lgu-activities/classroom_introspection_token';
const CORE_ENDPOINT = 'https://school.thegreekos.com/api/integrations/bbb/classroom/token/introspect';
const CORE_ISSUER = 'https://school.thegreekos.com';
const id = (value) => typeof value === 'string' && value.length > 0 && value.length <= 256
  && value.trim() === value && !/[\u0000-\u001f]/.test(value);

// Helper is server-only; production provider always uses the fixed path.
function readSecretFile(path, uid, gid) {
  let directoryFd;
  let fd;
  let bytes;
  try {
    const parent = require('node:path').dirname(path);
    if (fs.realpathSync(parent) !== parent) throw new Error('symlink parent');
    directoryFd = fs.openSync(parent, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    const directory = fs.fstatSync(directoryFd);
    if (directory.uid !== uid || directory.gid !== gid || (directory.mode & 0o7777) !== 0o700) throw new Error('directory permissions');
    fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const file = fs.fstatSync(fd);
    if (!file.isFile() || file.uid !== uid || file.gid !== gid || (file.mode & 0o7777) !== 0o600 || file.size !== 64) {
      throw new Error('secret metadata');
    }
    bytes = fs.readFileSync(fd);
    if (bytes.length !== 64 || !/^[!-~]{64}$/.test(bytes.toString('ascii'))
      || bytes.some((byte) => byte > 126)) throw new Error('invalid credential');
    return bytes.toString('ascii');
  } catch { throw new ContractError('CORE_SERVICE_CREDENTIAL_INVALID', 503); }
  finally {
    if (bytes) bytes.fill(0);
    if (fd !== undefined) fs.closeSync(fd);
    if (directoryFd !== undefined) fs.closeSync(directoryFd);
  }
}
function readServiceCredential() {
  try {
    const uid = Number(execFileSync('/usr/bin/id', ['-u', 'bigbluebutton'], { encoding: 'utf8' }).trim());
    const gid = Number(execFileSync('/usr/bin/id', ['-g', 'bigbluebutton'], { encoding: 'utf8' }).trim());
    return readSecretFile(SECRET_PATH, uid, gid);
  } catch { throw new ContractError('CORE_SERVICE_CREDENTIAL_INVALID', 503); }
}

function createCoreCredentialVerifier({ fetchImpl = fetch, readCredential = readServiceCredential,
  clock = () => Math.floor(Date.now() / 1000) } = {}) {
  // Injected transports/readers are exclusively server-side testing seams.
  // Neither endpoint nor secret path can be selected by the browser.
  return async (token, bbb) => {
    if (typeof token !== 'string' || !token.length || token.length > 8192
      || !bbb || bbb.online !== true || ![bbb.extId, bbb.externalMeetingId, bbb.meetingId, bbb.participantId].every(id)
      || typeof bbb.moderator !== 'boolean') throw new ContractError('BBB_PROOF_INVALID', 401);
    // Core role is association, not BBB organiser authority. Core validates its
    // credential role; organiser is independently derived from BBB moderator.
    const expected = { personId: bbb.extId, meetingId: bbb.externalMeetingId, kind: 'lesson' };
    let credential;
    try { credential = readCredential(); }
    catch { throw new ContractError('CORE_SERVICE_CREDENTIAL_INVALID', 503); }
    let response;
    try {
      response = await fetchImpl(CORE_ENDPOINT, { method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
        signal: AbortSignal.timeout(5000), headers: { Authorization: `Bearer ${credential}`,
          'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ token, expected }) });
    } catch { throw new ContractError('CORE_INTROSPECTION_UNAVAILABLE', 503); }
    finally { credential = null; }
    if (response.status === 400) throw new ContractError('CORE_INTROSPECTION_REQUEST_INVALID', 503);
    if (response.status === 401) throw new ContractError('CORE_SERVICE_AUTH_FAILED', 503);
    if (response.status !== 200) throw new ContractError('CORE_INTROSPECTION_UNAVAILABLE', 503);
    let result;
    try { result = await response.json(); }
    catch { throw new ContractError('CORE_INTROSPECTION_RESPONSE_INVALID', 503); }
    const data = result?.data;
    if (data?.active === false) {
      const error = new ContractError('CORE_IDENTITY_INACTIVE', 403);
      // Only field-name enums; never disclose Core subject values or raw errors.
      error.mismatches = Array.isArray(data.mismatches)
        ? [...new Set(data.mismatches.filter((field) => ['personId', 'meetingId', 'role', 'kind'].includes(field)))] : [];
      throw error;
    }
    if (data?.active !== true || result.error !== null || result.meta?.readOnly !== true
      || result.meta?.preview !== false || result.meta?.dryRun !== false || data.reason !== 'OK') {
      throw new ContractError('CORE_INTROSPECTION_RESPONSE_INVALID', 503);
    }
    const subject = data.subject;
    const session = data.session;
    if (!subject || subject.personId !== expected.personId || subject.meetingId !== expected.meetingId
      || !['teacher', 'student'].includes(subject.role) || subject.kind !== 'lesson'
      || (Array.isArray(data.mismatches) && data.mismatches.length)) {
      throw new ContractError('CORE_IDENTITY_BINDING_MISMATCH', 403);
    }
    // Core's launched BBB room is `created` while its verified lesson identity
    // is already active. Do not confuse that lifecycle label with token activity.
    if (!id(subject.lessonSessionId) || session?.provider !== 'bbb4' || !['created', 'active'].includes(session?.status)
      || ![session?.lessonId, session?.classId, session?.teacherPersonId].every(id)
      || (subject.role === 'teacher' && session.teacherPersonId !== subject.personId)
      || (subject.role === 'student' && session.teacherPersonId === subject.personId)) {
      throw new ContractError('CORE_SESSION_INVALID', 403);
    }
    if (typeof subject.expiresAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(subject.expiresAt)) {
      throw new ContractError('CORE_EXPIRY_INVALID', 403);
    }
    const expiresAt = Math.floor(Date.parse(subject.expiresAt) / 1000);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= clock()) throw new ContractError('CORE_IDENTITY_EXPIRED', 403);
    // Participant ID is bound AFTER pre-join Core token issuance, using the
    // independently authenticated BBB session, not an invented Core claim.
    return { issuer: CORE_ISSUER, personId: subject.personId, role: subject.role,
      meetingId: subject.meetingId, participantId: bbb.participantId,
      expiresAt, membershipActive: true, lessonSessionId: subject.lessonSessionId };
  };
}
module.exports = { SECRET_PATH, CORE_ENDPOINT, CORE_ISSUER, readSecretFile,
  readServiceCredential, createCoreCredentialVerifier };