# Activity identity v1 — Phase 2

Status: implemented adapter + plugin client + production Core introspection provider. **Not hosted/activated or real-account accepted.** Core introspection contract (Core commit `c8e1789`, user-supplied) is wired and live service authentication has passed with intentionally invalid, non-personal data. No LGU changes, migrations or PR #46 dependency. Current evidence: `CORE_INTROSPECTION_VALIDATION.md`; earlier phase reports are historical.

## Existing verified integration

- Lesson Assistant `/root/tgos-lesson-assistant/API_CONTRACT.md`, `src/remote-api.js`, `src/lesson-context.js`, `src/meeting-presence.js` were read only.
- BBB `/join userID` is exactly `school_core.people.id`; BBB exposes it as `extId`. BBB internal `userId` is a connection participant, not the permanent student ID. Names never authorize or join identities.
- Self-only SDK `useCustomQuery` reads `user_metadata(parameter,value)` to obtain `schoolcore_context_token` from join userdata. No other user's token is read.
- Existing Core `GET /api/integrations/bbb/classroom/context`, with Bearer header, provides authoritative `data.teacher.personId`, `data.students[].studentId`, and meeting context. No placement/curriculum writes are used here.
- Existing server-side BBB `GET /bigbluebutton/connection/checkGraphqlAuthorization` is the GraphQL middleware auth hook. Read **HTTP response headers**, not invented JSON fields: `Meeting-Id`, `Meeting-External-Id`, `User-Id`, `User-External-Id`, `User-Is-Moderator`, `User-Currently-Online`. Forward the same-origin BBB session cookie only to the fixed, server-configured local BBB hook; never to Core. Require current online membership, not merely a valid old/removed session.

## Trust providers — production gate

`server/identity-service.cjs` cannot be constructed without trusted providers, signing key, issuer and audience. The browser cannot supply providers or keys. No permissive fallback exists.

1. `verifyBbbProof({sessionToken,cookie})`: fixed BBB auth hook → current internal meeting ID, external meeting ID, internal participant ID, external person ID, current moderator role and online status. Implemented in `server/providers.cjs`; HTTP allowed only for fixed loopback hook, HTTPS otherwise; redirects denied.
2. `verifyCoreCredential(coreToken, verifiedBbb)`: implemented in `server/core-introspection.cjs`. Only AFTER online BBB session validation, POST to fixed `https://school.thegreekos.com/api/integrations/bbb/classroom/token/introspect`. Authentication uses the existing 64-byte service credential at `/etc/bigbluebutton/lgu-activities/classroom_introspection_token`, owner `bigbluebutton:bigbluebutton`, mode `0600`, protected parent `0700`; no environment variable/browser credential path or new credential. Request `{ token: <self Core token>, expected: { personId: <verified BBB extId>, meetingId: <verified BBB external meeting>, role: <teacher if moderator, otherwise student>, kind: "lesson" } }`. BBB internal meeting incarnation is separately retained in activity claims; do not send it as the Core external meeting identifier. No positive cache across requests.
	- Require `200`, `data.active === true`, `reason: "OK"`, `error: null`, `meta.readOnly: true`, `preview: false`, `dryRun: false`.
	- Compare `data.subject.personId/role/meetingId/kind` to expected bindings; validate ISO `expiresAt`, `lessonSessionId`, active `session.provider: "bbb4"`, lesson/class/teacher IDs and teacher identity consistency. Names are never used. Expiry is normalized to epoch seconds and clips the activity JWT.
	- Internal participant ID comes from independently authenticated BBB proof at this server exchange, NOT a fabricated pre-join Core claim. Normalized output `{ issuer: <configured Core origin namespace>, personId, role, meetingId, participantId: verifiedBbb.participantId, expiresAt, membershipActive: true, lessonSessionId }`. Core origin is an adapter namespace, not a claim that a Core JWT `iss` was decoded or inspected.
	- `200 active:false` denies (`403`); HTTP `400`, `401`, `503`, other failures, redirects, timeout, malformed/preview responses all fail closed with sanitized server error codes. Service `401` is an adapter credential problem (`503` outward), not a student auth failure. No upstream payload or mismatch details are logged or sent to the browser.
3. `readClassroom(coreToken)`: implemented HTTPS client for the existing context API. Require explicit `meetingId`, teacher ID and unique roster IDs. Absence/malformed scope fails closed. Normal-lesson response must provide meeting binding; `adhoc_test` is denied entirely. No names become permanent identities.
4. `resolveActivity(activityId)`: server-owned allowlist/catalog validation. Fixture catalog only here; later connect to LGU's existing activity catalog, not a second game engine.

Core credential subject, role, meeting and current lesson membership must match the BBB proof; current internal participant binding is established at the exchange. A successful teacher context GET alone is **not** a student-token introspection API. Student credential validation cannot be inferred from `?studentId=` or a teacher roster. `server/production-integration.cjs` composes the real BBB hook, Core introspector, existing classroom reader and existing identity service; it starts no listener and generates no credentials/signing keys. Host configuration/signing/allowlist and approved real teacher/two-student meeting access remain required for activation.

## Adapter API (new, implemented; not an existing Core/LGU API)

Same-origin HTTPS routes to mount later in the existing integration backend:

- `POST /api/lgu-activities/v1/identity`, exact body `{}`: authenticate both proofs; teacher only for this panel; return canonical teacher + authoritative roster, no tokens for students.
- `POST /api/lgu-activities/v1/contexts`, exact body `{ "activityId": "<approved-catalog-id>" }`: authenticated Core teacher AND current BBB moderator; create/reuse one server-owned context for internal meeting + teacher + activity. Return public context and teacher identity token. **Does not create an LGU Live session.**
- `POST /api/lgu-activities/v1/identities`, exact body `{ "contextId": "<server-id>" }`: each participant authenticates themself. Student must be the Core credential subject, current meeting member and in the authoritative context roster. Teacher cannot mint student tokens. Student response excludes teacher/roster records; only self identity and minimal context are returned.
- `POST /api/lgu-activities/v1/verify`, exact body `{ "contextId": "<server-id>", "identityToken": "<token>" }`: verify signature, issuer, audience, expiry, server context, activity scope, current BBB and Core proofs and role; bind proof subject to token subject. Intended adapter contract test endpoint; LGU redemption must enforce the same checks.

Every request carries `X-BBB-Session-Token` and `Authorization: Bearer <self-scoped Core token>`, with same-origin BBB cookies. No proof in URLs. Bodies reject unknown fields (`personId`, `studentId`, `role`, `meetingId`, etc.). Origin must match server configuration; no CORS wildcard; JSON POST only, bounded body, fixed route allowlist. Response `Cache-Control: no-store`; generic error codes, no token/proof logging. Client follows no redirects and retains returned activity token only in a closure, never DOM/storage/logs. Core context calls omit cookies and use no-store.

## Signed activity identity

JWT, `alg=EdDSA`, `typ=lgu-activity-identity+jwt`, server-controlled `kid`, exact issuer and adapter audience. Lifetime **at most 120 seconds**, clipped to Core credential and context expiry (context at most 5 minutes). Claims:

- `v: 1`, `iss`, `aud`, `iat`, `nbf`, `exp`, unique `jti`;
- `sub`: deterministic activity-scoped participant identity from `(Core issuer, contextId, canonical personId)`;
- `coreIssuer`, `corePersonId`, `role` (`teacher` or `student`), `scope` (`context:prepare` or `activity:participate`);
- `bbbMeetingId` (internal incarnation), `bbbExternalMeetingId`, `bbbParticipantId` (current internal participant);
- `activityId`, `contextId`; `lguSessionId: null` until LGU owns creation of a canonical session.

These are **adapter-audience** tokens, not LGU-ready tokens. Later exchange must mint an LGU-audience token with the canonical LGU session ID. LGU must reject adapter tokens/wrong audience and cannot trust browser identity fields. JWTs are signed, not encrypted; do not place names, roster, answers or credentials in claims.

Possessing another student's activity token is insufficient: use requires independent current BBB + Core proofs for the same person and participant. Stealing all authentication credentials is credential compromise, outside that guarantee; never claim bearer JWT alone prevents it. Revalidation prevents stale role/membership/meeting use. Reference context state is process-local and expires; production persistence/replication/revocation/key rotation must be supplied by the existing backend before activation, with no database migration assumed.

`/verify` performs **read-only, repeatable identity verification**, not one-time capability redemption. The same legitimate caller may verify repeatedly within TTL; this changes no game/session state. A later LGU token exchange/session-start endpoint MUST atomically consume or idempotently redeem the verified `jti` (keyed by issuer + audience + context + activity + caller) and return the same canonical session on duplicate start. Do not deploy this verifier as a session-start endpoint or mistake a unique `jti` for implemented replay storage. Redemption storage and mutation idempotency are explicit next-phase prerequisites, not a second BBB game engine.

## Reconnect and guests

- A reconnect in the same meeting/context with the same verified Core person returns the same `sub`/activity identity even if BBB internal participant ID/session proof changes. Re-introspect the current valid Core lesson token against the newly authenticated BBB proof and issue a short-lived activity token bound to the **new** participant; the old activity token cannot be used with the new participant proof. No new Core student identity or invented participant claim is issued.
- New BBB meeting incarnation or context generates a different activity-scoped identity. No permanent LGU account is fabricated.
- Missing Core credential, missing stable extId, unknown roster member, duplicate roster ID, unrelated moderator, guest or `adhoc_test` → deny. UI lists unmatched participants explicitly as temporary/unverified, never associates them by name, and never gives them an activity token. Production temporary/anonymous LGU mode is not enabled in v1.

## Acceptance evidence limits

Tests use synthetic subjects/mock HTTP for active results; real service-auth probe returns `200 active:false` for an intentionally invalid non-personal token. That proves service credential acceptance only. **No real teacher/student BBB proof has passed introspection yet.** The user-shared authenticated teacher lesson workspace is available, but it shows one enrolled student and no BBB meeting client tab accessible to the agent. Do not count the workspace, probe or earlier Test Room reports as teacher/student acceptance. Full gate remains blocked until approved BBB teacher/Students A+B proofs and Live activation are accessible.