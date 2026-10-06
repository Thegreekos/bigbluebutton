# Scoped service + real participant acceptance — 2026-10-06

Branch `feat/lgu-activities-plugin`, baseline `7efc09e5ba`. **Partial real acceptance achieved; full READY remains NO.** This is the current report; prior reports are historical.

## Installed runtime

- `bbb-lgu-activities.service`: **active/running**, `User=bigbluebutton`, `Group=bigbluebutton`; installed as regular systemd unit, **boot enablement disabled** for acceptance scope.
- Root-managed code/dependencies: `/usr/local/bigbluebutton/lgu-activities`; listener only `127.0.0.1:4703`. Health returns `{status:"ready",scoped:true}`; it is a runtime/readiness check, not cached Core authorization.
- Protected host config: `/etc/bigbluebutton/lgu-activities/adapter.json`. Only the selected real Portal external meeting ID is allowlisted; no IDs in this report/Git templates. Activity allowlist is empty, so no activity/session/game is created.
- Existing introspection credential unchanged: `/etc/bigbluebutton/lgu-activities/classroom_introspection_token`, regular non-symlink, owner `bigbluebutton:bigbluebutton`, `0600`, 64 bytes, parent `0700`.
- Activity JWT signing key provisioned server-only at `/etc/bigbluebutton/lgu-activities/activity-signing-key.pem`, owner `bigbluebutton:bigbluebutton 0600`. This is the existing activity-contract signing key, not a new School Core issuer/service credential. Neither private key nor credential/hash was printed or committed.
- systemd hardening includes NoNewPrivileges, ProtectSystem=strict, ProtectHome, PrivateTmp, empty capability set and UMask0077. `/healthz` not exposed by nginx.
- `/etc/bigbluebutton/nginx/lgu-activities.nginx` forwards only exact identity API routes (`self`, `identity`, `contexts`, `identities`, `verify`) to loopback. Request access log/proxy cache disabled; exact-origin JSON POST proof checks remain server-side. `nginx -t` passed, nginx reloaded; only LGU service restarted, no BBB core services restarted.
- Official built assets hosted under `/var/www/bigbluebutton-default/assets/plugins/lgu-activities/`, release 0.2.0 with matching manifest/SRI. Public manifest verified. No global plugin activation, Lesson Assistant asset/config changes or database edits.

## Real Portal flow used

Found an existing Portal-synced BBB4 group class with **four enrolled students**, opened its scheduled lesson and used the normal **Launch**, then **Join meeting** flow. Core created a real teacher handoff. Integrated-browser standard clicks did not trigger some React/Radix controls; activating the same rendered UI element and following the returned Core handoff completed navigation. No handwritten Core/BBB joins or fabricated identities were used.

Teacher's actual BBB client loaded the existing Lesson Assistant. Own `schoolcore_context_token` was retrieved from existing self-scoped `/api/rest/userMetadata`, authenticated by own BBB session cookie + `x-session-token`. Teacher `/identity` and participant `/self` sent **body `{}` only**: BBB/session/Core proofs in headers, no person/student/role/meeting identity assertions in body. The running adapter derived these from the BBB auth hook and used the real server-to-server Core introspector.

Students A and B joined through separate **personal Copy join link** controls in the existing Students tab, then each personal Core **Μπες στο μάθημα** action. Separate Playwright browser contexts ensured no shared teacher/student cookies or storage. No passwords, private join URLs, personal names/IDs, tokens or payloads are recorded here. Raw credentials remained ephemeral within browser memory/evaluation; only status/role/equality booleans were returned as evidence.

## Real results (NOT fixtures)

| Requirement | Result | Observed evidence |
| --- | --- | --- |
| Teacher → verified teacher/current BBB moderator | **PASS** | Real `/identity` and final `/self`: HTTP 200, role teacher; roster count four |
| Student A → canonical Core student | **PASS** | Own personal join, real `/self`: HTTP 200, role student |
| Student B → canonical Core student | **PASS** | Own separate personal join, real `/self`: HTTP 200, role student |
| A and B canonical identities different | **PASS** | In-memory comparison true, no raw person IDs returned |
| B classroom token + A authenticated BBB session | **PASS** | HTTP 403, `CORE_IDENTITY_INACTIVE`, sanitized mismatches includes `personId` |
| Student cannot obtain teacher authority | **PASS** | A calling teacher `/identity`: HTTP 403 `TEACHER_REQUIRED` |
| Student A reconnect preserves canonical identity | **PASS (reload/reconnect)** | Actual BBB client reloaded and reauthenticated; new own metadata read, real `/self` HTTP 200 student; prior/current canonical person equality true |
| True unknown/non-Core participant fail closed | **BLOCKED / not established** | Observed generic participant link also obtained Core-verified student credential; it cannot be labeled unknown. No non-Core enrolled identity was invented |
| Official LGU Activities → Live teacher-only unlock | **BLOCKED / not loaded** | Actual teacher DOM loader shows Lesson Assistant present, LGUActivities absent; no supported plugin insertion API for existing meeting |

The initial teacher request failed locally with `CORE_SESSION_INVALID`. A temporary opt-in diagnostic printed **only booleans and allowlisted session status**, not IDs/response/credentials. It established real `data.active:true` with `session.status:created`, `provider:bbb4` and all binding checks valid. Fixed the provider to accept `created` **or** `active` only after all existing active/binding/expiry/meta checks. Regression confirms inactive/ended deny. Diagnostic and systemd override were removed and provider reinstalled; final teacher/A/B self checks all returned HTTP 200.

`/self` is minimal self-only introspection, not a game engine or student roster endpoint. Inactive errors retain only enumerated mismatch field names, never subject values or upstream raw errors. No positive introspection cache.

## Validation

- LGU Activities suite: **63/63 PASS**, no skips (includes scoped allowlist immutability, empty-scope denial, self response minimization, created lifecycle and safe mismatch output).
- Production Webpack/SRI/bundle-exclusion checks: **PASS**, unchanged browser bundle 246,992 bytes.
- Browser verification: **11 groups PASS** in synthetic SDK harness; reported separately from real checks above.
- Running adapter loopback health, systemd user/state, nginx syntax and public manifest: **PASS**.
- Real service-auth probe as `bigbluebutton`: **PASS**, HTTP200 active:false for intentionally invalid non-personal token.
- No editor diagnostics; whitespace/syntax validation. No real identity claims from fixtures.

## Remaining exact activation requirement

BBB plugin loading is captured at meeting **creation**; source inspection found no supported existing-meeting add/update API. The current real Portal `/create` included Lesson Assistant only. Core must include the hosted LGU manifest in **one** approved lesson `/create` call, preserving Lesson Assistant, before creation of a fresh meeting. Non-secret `liveActivityId` must be a reviewed existing activity ID in both plugin settings and adapter allowlist. No LGU game should start. The authoritative Core caller is the previously identified `app/api/src/providers/bbb/bbb.provider.js` on the separate Core host; it is not accessible for editing here. No guessed browser request parameter or DB/core mutation substitutes for that change.

Separately use an approved true non-Core guest path to complete the unknown gate; do not count generic link behavior as proof without verifying absent Core identity. A/B remain genuine personal enrolled participants and their PASS evidence stands independently.

## Cleanup / rollback / boundaries

All automation-created isolated student contexts and the automated teacher BBB tab were closed after final checks; teacher workspace preserved. Temporary browser window.open/clipboard overrides restored; ephemeral test credential variables removed. No session/browser credential persisted to disk. Lesson enrollment/platform/schedule/placement unchanged; only its requested meeting was launched, no LGU game.

Scoped service remains active with one external meeting allowlisted, empty activity allowlist and no boot enablement. To freeze it, set host `allowedMeetingIds: []` and restart **only** this service. To remove routes, stop `bbb-lgu-activities`, remove only its nginx snippet, `nginx -t`, reload nginx. Keep service credential/signing key protected; no blind deletion. Hosted assets are inert without meeting manifest. Full key rotation/restart continuity/context persistence remain separate production rollout work.

No LGU repo/PR #46 access or changes, LGU endpoint/DB/scoring/live engine, migrations, BBB core source changes, global plugin configuration, public security PR or Git push. Host activation was explicitly authorized for scoped acceptance.

**READY FOR LGU LIVE INTEGRATION: NO** — real canonical participant path is now proven, but true unknown and officially loaded Live UI gates remain open.