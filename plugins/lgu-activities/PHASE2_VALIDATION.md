# Phase 2 identity preparation — 2026-10-06

Branch: `feat/lgu-activities-plugin`. Starting commit: `f21c4e1ab05226675b4d76b685b92b89e6d7e53b`, clean worktree. Plugin release: `0.2.0`.

## Outcome

**Implemented and verified locally:** identity contract v1, server-only signed identity reference adapter, existing BBB/Core HTTP client contracts, same-origin plugin integration, canonical roster-ID display, guests fail-closed, and synthetic acceptance fixtures.

**BLOCKED, not passed:** real School Core teacher/student validation and real BBB meeting acceptance. Only BBB repository + `/root/tgos-lesson-assistant` external source are available on this server. No authoritative School Core server checkout/token issuance/verifier or authorized real-account meeting flow was available. The actual Core validator cannot be safely inferred from its classroom GET response. The mandatory production `verifyCoreCredential` provider is deliberately not implemented with a fake decoder or permissive identity lookup. No production listener/default signing credential exists.

## Reused existing APIs and patterns

- Lesson Assistant's stable join mapping: `/join userID = school_core.people.id`, exposed as BBB `extId`; `userId` remains the BBB internal participant ID.
- SDK self-only `useCustomQuery` → `user_metadata` → `schoolcore_context_token`, plus `getSessionToken`, `usePluginSettings` and meeting-scoped presence subscription.
- Core `GET /api/integrations/bbb/classroom/context`, Bearer header, omitted cookies, no-store. Implemented reader tested with shaped HTTP fixtures; no real Core request was made. No placement/curriculum writes or `?studentId=` identity inference.
- BBB existing `checkGraphqlAuthorization` auth hook, server-only `x-session-token` + session cookie. Verified field names from `ConnectionController.groovy`; provider tested with mock HTTP response headers, not against a real session.
- Existing official Generic Sidekick → Apps Gallery registration and Lesson Assistant build/root lifecycle pattern; no edits to Lesson Assistant, BBB core or server configuration.
- New `/api/lgu-activities/v1/*` routes belong to the implemented reference adapter, **not** claimed existing School Core or LGU APIs.

## Test/build results

| Check | Result |
| --- | --- |
| Clean lockfile install (`npm ci --no-audit --no-fund`) | PASS, 141 packages |
| Unit/UI/identity/provider/client/HTTP/lifecycle tests | PASS, **43/43**, no skips |
| Production Webpack build | PASS, SDK 0.1.26, browser bundle **246,992 bytes** |
| Manifest/version/SDK/SRI/no-fixture-secret checks | PASS |
| Byte-identical rebuild after clean install | PASS |
| Chromium signed-adapter/real-SDK harness | PASS, **11 verification groups** |
| JS syntax checks, editor diagnostics, whitespace check | PASS |

Bundle SHA-256: `ae7e33b4bbac083ad13d2566a6439b33d4fe8c30c6783b48d5fb1a02126f9e7d`.

Manifest SRI: `sha384-Cyuje3coAESGR/TOpId+1C3ZzvWQPX24tVwHEjbMNBAG5UoHh1f3/UriDJ+kwrV5`.

## Acceptance matrix

| Required property | Local evidence | Real-account/meeting status |
| --- | --- | --- |
| Teacher recognized as teacher | Synthetic canonical Core teacher + matching online BBB moderator proofs; unrelated moderator/viewer denied | **BLOCKED** |
| Student maps to correct Core identity | Synthetic students `29`/`31`, same display name, exact stable extId + verified subject; self-only exchange | **BLOCKED** |
| Other student cannot use first student's identity | Student B's own proofs + A's JWT rejected; mixed BBB/Core proofs rejected; real local HTTP handler exercised | Fixture PASS; real-account untested |
| Viewer/student has no teacher authority | Body role override, BBB-only elevation, wrong Core role, teacher token with student proofs all denied | Fixture PASS; real-account untested |
| Unknown/guest/test participant fails closed | Empty extId, no Core proof, outside roster, duplicate IDs and `adhoc_test` denied; UI guest explicitly temporary/unverified | Fixture/harness PASS; real-account untested |
| Reconnect does not create a new person/activity identity | New BBB participant proof for same Core person/context has identical activity subject, new participant-bound JWT; old JWT rejected with new proof | Fixture PASS; real reconnect untested |

Repeated read-only verification by the same caller is intentional and tested. Future LGU mutating start/exchange must have atomic one-time/idempotent `jti` redemption; no such mutation is implemented/claimed here. Stable activity identity holds within the same live context; context expiry/new meeting creates a new activity scope, never a new permanent Core student.

## Browser evidence

Chromium `141.0.7390.37`, ephemeral loopback-only server, real generated manifest/SRI, real built SDK/plugin and real EdDSA adapter. BBB hook responses/metadata/settings/presence and Core proof validation are explicitly synthetic. Two students deliberately have the same display name to demonstrate IDs, not names, govern mapping. Six same-origin adapter requests were observed; no external requests, page/console errors, proof/token in DOM or local/session storage.

Checked one Apps entry, keyboard opening, Core teacher display, stable roster mapping and guest labeling, Live context preparation with `lguSessionId: null`, close/reopen, role/error changes, mobile layout, refresh, initial viewer denial and missing-proof Live lock. Browser test closes its server/browser. Generated evidence remains Git-ignored in `.local/browser-verification.json` and `.local/teacher-panel.png`. `npm start` has **no fixture identity service** unless explicitly passed `--identity-fixtures`.

## What was NOT tested or changed

No real BBB meeting was created/joined and no real teacher/student was authenticated. Earlier Lesson Assistant meeting reports are historical references, not LGU Phase 2 evidence. No Core source/API changes, token refresh or issuance integration, real BBB auth-hook request, real classroom read, LGU session, engine, question, answer, score or mastery was tested or implemented.

All Git changes are inside `plugins/lgu-activities/`. No LGU repository/PR #46 access/change/wait/dependency; no database migration, production asset copy, nginx/global plugin config change, service restart, deployment, push or public PR. No migration is necessary for the process-local reference context; production state storage/key rotation/rate-limit integration must be reviewed separately using existing backend facilities. Stop before any migration if that review finds one necessary.

## Exact unblocking input

Provide authoritative School Core server source/owner-reviewed token validator or existing authenticated introspection seam, including actual teacher/student token subject/role/meeting/participant-binding/expiry/refresh policy and current membership lookup. Confirm normal context response meeting binding. Then provide explicitly authorized teacher + student test-meeting access in a non-production or separately approved controlled environment. Until then keep Live fail-closed in real meetings; do not deploy fixture providers.

After that gate, follow `LGU_HANDOFF.md`: federated canonical person mapping, trusted session-bound LGU-audience exchange, idempotent teacher start, student self join/reconnect and one question/answer/LGU-result using LGU's existing engine.