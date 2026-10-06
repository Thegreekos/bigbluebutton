# LGU Activities participant contract v2 — Core + guest

Current contract for release **0.3.0**. Supersedes acceptance-only v1. No LGU repository/account/game implementation is included.

## Trust and authority

Every operation first validates the real BBB session with the existing auth hook, requiring an online participant, internal/external meeting IDs, participant ID and boolean moderator state. These come from server response headers, never browser body or display names. All five adapter routes are same-origin JSON POST with bounded bodies, no-store responses, sanitized errors and nginx rate limits. No caller may submit identity/role/student/meeting assertions.

**Organiser authority is exactly current `BBB moderator === true`**, independently of Core association. Core teacher role with BBB viewer role does not confer authority; a verified non-Core moderator can organise. Students and guest viewers can join a meeting organiser's approved context but cannot create it, obtain roster data or inherit organiser scope. All proofs/authority are revalidated when issuing/verifying activity credentials.

## Modes

| Property | Core participant | Guest participant |
| --- | --- | --- |
| Proof | Verified BBB + valid own Core token | Verified BBB only; Core token absent |
| mode | `core` | `guest` |
| Core person/issuer | Verified canonical `people.id` + Core origin namespace | Explicit `null` |
| association role | Validated `teacher` or `student` | `guest` |
| organiser | Current BBB moderator flag | Current BBB moderator flag |
| principal | Stable hash of Core issuer + person ID | Hash of adapter issuer + internal meeting incarnation + verified participant ID |
| persistentHistoryEligible | true; later LGU server mapping required | false; no permanent LGU account/student history |
| learning context | Own authorized Core level/unit/book if available | null; never inherited from another participant |
| activity/level choice | Organiser approved selection | Same organiser approved selection, never inferred Core placement |

Core token present: POST to the fixed authoritative Core introspection endpoint with existing server-only service credential and `{ token, expected: { personId: <BBB extId>, meetingId: <BBB external meeting>, kind: "lesson" } }`. Core role is validated from the authoritative response rather than inferred from the independent BBB moderator flag. Require `data.active:true`, matching subject/meeting/kind, valid teacher/student role, future expiry, non-preview/read-only result and valid `bbb4` session (`created`/`active`). Do not cache positive results. Invalid/expired/mismatched credential, HTTP 400/401/503, timeout or malformed response denies; **never guest fallback**.

Token absent: no Core introspection, secret read or classroom request. Missing external person ID is allowed; guest identity uses internal meeting/participant IDs. Guest sessions can work even if Core/its credential is unavailable. Empty/invalid Authorization is rejected, not treated as absence. Plugin separately distinguishes valid empty self metadata from loading/errors/duplicate or malformed token rows; these errors never enable guest UI. A caller choosing no Core association can only become a temporary guest, never gain persistent history or authority beyond BBB role.

Core enrichment is optional after successful identity verification. Existing classroom GET must match the verified meeting and person scope; malformed/failed enrichment yields `learningContext:null` and `enrichmentStatus:unavailable`, not invented level/unit and not lost BBB organiser authority. `/self` exposes only own identity/context, never classroom roster. Only a Core-associated organiser with an authorized classroom response sees a roster; guests/other organisers see no roster. Presence roster matches are observations, not issued participant identities.

## API and tokens

- `/api/lgu-activities/v1/self`, body `{}`: self identity, `mode`, stable/temporary `principalId`, nullable Core IDs, association `role`, `organiser`, history eligibility and expiry, optional own learning context.
- `/identity`, body `{}`: organiser-only, same identity plus optional authorized classroom/enrichment.
- `/contexts`, body `{activityId}`: organiser-only approved activity choice, transient context bound to meeting + organiser principal. No LGU session/game. Max 5-minute context, max 1,000 live contexts/process; capacity fails closed.
- `/identities`, body `{contextId}`: each online participant obtains only their own identity within the same meeting context. Guest viewers may participate; roster is not a substitute for individual Core introspection.
- `/verify`, body `{contextId,identityToken}`: read-only verification, fresh BBB/Core proofs, same principal/mode/role/current authority/participant/meeting/context/activity.

Signed activity JWT: **v=2**, EdDSA, fixed issuer/audience/kid/type, `iat/nbf/exp/jti/sub`, plus `mode`, `principalId`, `organiser`, `persistentHistoryEligible`, `coreIssuer`, `corePersonId`, association `role`, scope, both BBB meeting IDs, current participant ID, activity/context IDs and `lguSessionId:null`. Guest Core IDs are null. Scope is organiser `context:prepare` or participant `activity:participate`. TTL at most120s clipped to Core expiry (if any) and context expiry. V1 and missing/altered v2 fields are rejected.

Core principal is stable across meetings/reconnects; activity subject is scoped to context + principal. Guest principal cannot persist across meeting incarnations or a new verified participant ID; no name/extId matching can promote it. Old JWTs cannot be reused with another participant, mode, authority or context. Tokens stay in the client closure, not DOM/storage/URLs/logs; service secret/private signing key never enters browser bundle.

## Production service boundary

`bbb-lgu-activities`: enabled for boot, non-root `bigbluebutton`, loopback4703, hardened systemd. Config explicitly requires `meetingScope:all-verified-bbb`; no acceptance lesson allowlist. Only the approved activity allowlist restricts context choices. Core service secret remains protected fixed file0600/parent0700, read only on Core requests. Guest startup does not require Core connectivity/secret. TLS terminates through existing BBB nginx; exact routes have body limit16k and IP rate30r/s burst60, 429 on overload; access logging/cache disabled. `/healthz` loopback only.

Context state is intentionally transient memory, not game/history storage. Service restart drops prepared contexts safely; participants reauthenticate/reprepare. It is not seamless live-game resume or HA session storage. Future LGU engine owns canonical sessions, persistence/scoring/mastery and idempotent mutations. Production key rotation and HA engine rollout remain separate operations; no migration is needed/applied here. Do not mistake `persistentHistoryEligible` or a stable association key for an existing provisioned LGU account.

## Engine integration boundary

Adapter-audience tokens cannot directly authorize LGU game commands. Later trusted exchange must revalidate current proofs/membership/organiser scope, bind canonical LGU session ID and issue LGU-audience credentials. Guest credentials must remain session-local, history disabled and never acquire Core placement. Core claims must map to existing LGU identity server-side; no name/browser-ID matching. Session start/answers require LGU's own atomic idempotency/`jti` redemption, not repeatable `/verify`. No game endpoint or second quiz engine exists here.

Current real evidence: `PRODUCTION_MODES_ACCEPTANCE.md`. Prior reports and `IDENTITY_CONTRACT.md` v1 are historical.