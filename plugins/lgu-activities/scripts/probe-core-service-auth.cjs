// Explicit opt-in live service-auth probe. NO real user identity/token input,
// NO payload/response/credential logging; never a real-account acceptance test.
const { createCoreCredentialVerifier } = require('../server/core-introspection.cjs');

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--live-service-auth-only') {
    console.error('Explicit --live-service-auth-only required'); process.exitCode = 1; return;
  }
  try {
    await createCoreCredentialVerifier()('lgu-service-auth-probe-intentionally-invalid-token', Object.freeze({
      extId: 'lgu-probe-not-a-real-person', externalMeetingId: 'lgu-probe-not-a-real-lesson',
      meetingId: 'lgu-probe-not-a-real-incarnation', participantId: 'lgu-probe-not-a-real-participant',
      moderator: false, online: true,
    }));
    console.error('Service-auth probe FAIL: unexpected active identity'); process.exitCode = 1;
  } catch (error) {
    if (error.code === 'CORE_IDENTITY_INACTIVE') {
      console.log('Service-auth probe PASS: HTTP 200, active:false; invalid non-personal token reached Core verifier.');
    } else {
      const allowed = ['CORE_SERVICE_CREDENTIAL_INVALID', 'CORE_SERVICE_AUTH_FAILED', 'CORE_INTROSPECTION_UNAVAILABLE',
        'CORE_INTROSPECTION_REQUEST_INVALID', 'CORE_INTROSPECTION_RESPONSE_INVALID'];
      console.error(`Service-auth probe FAIL: ${allowed.includes(error.code) ? error.code : 'FAIL_CLOSED'}`);
      process.exitCode = 1;
    }
  }
}
main().catch(() => { console.error('Service-auth probe FAIL'); process.exitCode = 1; });