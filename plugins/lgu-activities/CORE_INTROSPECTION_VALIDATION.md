# Core introspection wiring and validation — 2026-10-06

Branch: `feat/lgu-activities-plugin`; baseline `50faeb0979`, clean worktree. Core contract revision supplied by user: `c8e1789`. No Core checkout/commit inspection is claimed. This is the current report; previous phase reports describe historical blockers.

## Destination and one-time cleanup

First operation was metadata-only destination verification: **PASS** for existing regular non-symlink file, owner `bigbluebutton:bigbluebutton`, mode `0600`, size exactly 64 bytes at `/etc/bigbluebutton/lgu-activities/classroom_introspection_token`. Protected parent remains `bigbluebutton:bigbluebutton 0700`. No credential content or credential hash was output.

After PASS, removed only the dedicated `school-core-deploy@bbb4-introspection-transfer` entry from `/root/.ssh/authorized_keys` and deleted `/usr/local/sbin/receive-lgu-introspection-secret`. **Cleanup PASS**; remaining authorized key content unchanged; `sshd -t` passed. No SSH service restart or other key edits. Existing service credential was reused; no replacement generated.

## Implemented wiring

- `server/core-introspection.cjs` implements `verifyCoreCredential(token, verifiedBbb)` with fixed POST endpoint `https://school.thegreekos.com/api/integrations/bbb/classroom/token/introspect`.
- Only server reads service credential through protected, non-symlink file descriptor after file/directory ownership/mode/size checks. Each introspection request reads it again; no positive introspection cache. Response/request contents and upstream errors are never logged.
- `Authorization: Bearer <service credential>`; JSON `{ token: <own classroom credential>, expected: { personId: <verified BBB extId>, meetingId: <verified BBB external meeting>, role: <teacher iff current moderator, otherwise student>, kind: "lesson" } }`. HTTPS, no cookies, no redirects, no-store, 5-second timeout.
- `identity-service.cjs` authenticates and validates current online BBB session **before** Core introspection, then passes an immutable BBB proof snapshot. No browser identity/role/meeting body is trusted. BBB internal meeting incarnation remains in activity claims; Core `meetingId` is the external Core-generated meeting ID.
- Require `data.active:true`, authoritative matching `data.subject` person/role/meeting/kind, current active `session.provider:bbb4`, valid lesson/class/teacher/session IDs and future ISO expiry; reject preview/dry-run/error/malformed payloads. Clip activity JWT to normalized Core expiry.
- `active:false` denies with sanitized `403`; Core `400` → request/config error, `401` → service-auth misconfiguration, `503`/transport/other status → unavailable; all fail closed with sanitized outward `503`. No active identity fallback.
- Internal BBB participant binding is created server-side from the independently authenticated current session after Core validates its pre-join token. No invented Core participant claim, migration or second identity issuer.
- `server/production-integration.cjs` composes existing identity service, real BBB hook verifier, Core introspector and classroom reader. It does not start a listener, deploy the plugin, create activity-signing keys or bypass the host's required keys/allowlist/config.

## Tests and build

| Check | Result |
| --- | --- |
| Clean `npm ci --no-audit --no-fund` | PASS |
| Existing + new adapter/provider/secret-reader tests | **57/57 PASS**, no skips |
| `active:true/false`, HTTP `400/401/503`, malformed response/expiry/session, binding mismatch | PASS with synthetic HTTP fixtures |
| Verified immutable BBB expected bindings; offline denied before introspection; no positive cache | PASS |
| Provider/service composition: teacher/student issuance, cross-student token denial, canonical reconnect identity | PASS with mock Core transport only |
| Production build/SRI checks (`npm run check`) | PASS; unchanged browser bundle 246,992 bytes |
| Real-SDK local browser harness | **11 verification groups PASS**; synthetic participants, not actual meeting acceptance |
| JS syntax, editor diagnostics, `git diff --check` | PASS |
| Actual service credential exclusion from source/build files, executed as `bigbluebutton` | PASS; only sanitized output, no credential/hash |

No new package dependency, browser source, bundle release, manifest credential or environment variable was required. The browser bundle excludes secret path/provider/introspection endpoint strings. Existing `.env` is not needed: the credential is a server-only file, not an environment variable.

## Real Core service authentication probe

**PASS:** ran `scripts/probe-core-service-auth.cjs --live-service-auth-only` as Unix user `bigbluebutton` using the real transferred service credential. Sent an intentionally invalid token and fictional non-personal expected person/meeting bindings. Received **HTTP 200, `data.active:false`**, through the real implemented provider.

This proves only that service authentication reached Core's verifier and inactive identities are denied. It does **not** prove a real person identity, real mismatch reasons, teacher/student role or enrollment. No real participant token/ID was sent in this probe. No response body, token, credential or hash was displayed/stored. The public unauthenticated GET documentation fetch returned Not Found; that is unrelated to and not a substitute for this authenticated POST result.

## Real participant acceptance — BLOCKED

The user opened/shared an authenticated School Core Teacher Workspace for an active Portal-supplied BBB4 lesson. This confirms platform access only, not an independently validated BBB participant. The visible lesson reports **one enrolled student**, not two. No class/enrollment/platform override was changed.

Attempted the normal approved **Join meeting** control: regular browser click timed out; targeted activation succeeded but yielded no BBB client page accessible in the shared browser context. No join URL/token was copied, no credential was retrieved from logs/database, and no synthetic meeting/student was created. No participant introspection request was made. Therefore:

| Real acceptance requirement | Result |
| --- | --- |
| Teacher → introspected verified teacher/current moderator | **BLOCKED / NOT RUN**: authenticated BBB meeting proof unavailable to agent |
| Student A → own canonical Core identity | **BLOCKED / NOT RUN**: student session/proof not shared |
| Student B → different canonical Core identity | **BLOCKED / NOT RUN**: second enrolled student/session unavailable in selected lesson |
| B token + A authenticated BBB identity → inactive/personId mismatch | **BLOCKED / NOT RUN** on real accounts; synthetic test PASS is not real evidence |
| Student has no teacher authority | **BLOCKED / NOT RUN** on real accounts |
| Student reconnect → same canonical Core identity | **BLOCKED / NOT RUN** on real accounts |
| Unknown participant fail-closed; Live unlocks only for verified teacher | **BLOCKED / NOT RUN** in real meeting |

Required next access: share the actual teacher BBB meeting client tab, plus approved personal BBB sessions for enrolled Students A and B in a normal lesson with two enrollments. Provide/approve existing host adapter signing/allowlist/routing and scoped plugin activation before testing panel Live unlock. Do not fabricate enrollments, identities, join links or activity IDs to close this gate. Report only anonymized references/equality outcomes; never real person IDs/names, personal join links or token payloads.

## Scope / readiness

Only plugin server/provider/tests/docs/build check changed in Git. Host changes were limited to verified existing secret and removal of one-time transfer key/receiver. No Core source change, database migration, LGU repository/PR #46 access, LGU engine/session/game, public security PR, production adapter service/nginx/asset deployment or global meeting activation occurred. No push.

**READY FOR LGU LIVE INTEGRATION: NO.** Real service authentication is unblocked; real teacher/two-student identity acceptance remains blocked. Stop before any LGU endpoint implementation.