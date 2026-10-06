# Production participant modes acceptance — 2026-10-06

Branch `feat/lgu-activities-plugin`, baseline `4e69a75f65`; release **0.3.0**, activity identity schema **v2**. Current evidence/contract: this report and `IDENTITY_V2.md`. Previous phase reports record historical requirements/results, not current guest policy.

**READY FOR LGU ENGINE INTEGRATION: YES** for the next engine-integration task. This does not claim an existing LGU engine endpoint, account provisioning, gameplay, scoring/mastery/history persistence, seamless game resume or game production deployment.

## Official new-meeting load — real PASS

Opened a different existing Portal-supplied group lesson (four enrolled students), not the already-created acceptance meeting. Used the normal Teacher Workspace **Launch → Join meeting → Core teacher handoff** after the Core manifest change and deployment of LGU0.3.0. No Core changes were made here.

The actual new BBB4 client official loader inserted **LGUActivities** and **TGOSLessonAssistant**, both with loader-provided UUID and SRI. LGU URL refers to immutable release0.3.0. Actual **Apps Gallery** showed both names; selecting the LGU role=button opened the organiser panel with Μαθαίνω, Παίζω and Live. The panel authenticated the real teacher BBB session and showed verified organiser + Core association. No manual script/SDK injection, DB patch, global manifest edit or BBB core source modification. Core owner had already enabled both manifests for new BBB4 meetings; that change was reused, not edited.

## Production adapter status — PASS

- `bbb-lgu-activities.service`: **active/running, enabled** for reboot; `User=bigbluebutton`, `Group=bigbluebutton`. Actual restart and subsequent real organiser verification passed. Reboot enablement is configured/checked; no disruptive host reboot was performed.
- Root-managed runtime `/usr/local/bigbluebutton/lgu-activities`, hardened unit under `/etc/systemd/system`, loopback-only127.0.0.1:4703. No root adapter, writable code, public health endpoint or browser credentials.
- Root-managed host config explicitly `meetingScope:all-verified-bbb`; acceptance-only meeting ID removed. All requests still require actual online BBB participant/session authentication. Non-secret `allowedActivityIds:[]` deliberately prevents context/game creation until approved organiser activity selection is integrated.
- Health returns ready + modes core/guest. Guest requests/startup do not require Core introspection/secret access; Core participants use fresh introspection every request with existing protected service credential. Supplied invalid/expired credentials deny, never silently become guests.
- Service secret remains regular non-symlink `bigbluebutton:bigbluebutton 0600`, exactly64 bytes, protected parent0700. Existing Ed25519 activity signing key0600 reused. No credential/key/hash in output/Git/bundle/manifest/settings. Credential-exclusion scan as service user passed.
- nginx exact same-origin routes: body16k, no proxy cache/request access log, timeout, IP rate30r/s burst60 and429 response; rate-limit zone contains only remote address, not identities/tokens. `nginx -t`/reload passed. No BBB core services restarted.
- Official immutable release0.3.0 and generated manifest/SRI installed under BBB `/plugins/lgu-activities/`; previous releases preserved. Static configuration does not expose `/etc/bigbluebutton/lgu-activities`.

## Real participant acceptance (not fixture substitutes)

| Requirement | Result | Real evidence |
| --- | --- | --- |
| Official Lesson Assistant + LGU load | **PASS** | New Portal-created meeting scripts have actual BBB loader UUID/SRI; both Apps entries rendered |
| Core student recognised | **PASS** | Personal enrolled student join in isolated browser context, actual BBB session → Core introspection → HTTP200 modecore, rolestudent, canonical Core association present |
| Persistent Core association | **PASS at adapter boundary** | Core mode marks stable issuer/person-derived principal and history eligibility; actual LGU account/history implementation remains next phase |
| Own role/learning context available | **PASS** | Real student `/self` enrichment statusavailable, organiserfalse; no student roster returned. No level/unit/person values included in report |
| Non-Core viewer becomes temporary guest | **PASS** | Separate real BBB administrative `/join` as viewer, no Core userID/userdata; self metadata confirmed Core credentialabsent; actual `/self` HTTP200 modeguest, null Core ID, historyfalse, learningContextnull |
| Guest viewer lacks organiser authority | **PASS** | Real organiser `/identity` denied403 `TEACHER_REQUIRED`; official LGU script loaded but no organiser gallery item |
| Core student lacks organiser authority | **PASS** | Real student identity organiserfalse; official plugin loaded but organiser item absent; no browser role assertion accepted |
| Core moderator opens app | **PASS** | Normal official Apps item opens organiser panel, server verification succeeds, three choices rendered |
| Non-Core moderator opens app | **PASS** | Separate actual BBB administrative moderator join without Core metadata: HTTP200 guest organiser, null Core IDs/historyfalse/contextnull; official Apps LGU panel opens with verified guest organiser label |
| Independence from previous acceptance lesson | **PASS** | New external meeting differs from old allowlist; no meeting list remains, actual calls succeed |

Guest checks used the real BBB join API signed server-side using existing BBB server configuration, in isolated headless Chromium contexts. They were temporary named acceptance guests/moderators, **not School Core accounts**, fake Core IDs, fixture identities, or reuse of a Core personal student link. The test helper has explicit opt-in flags and no automatic run; secret/join URLs stay in server/browser memory, only booleans/status are printed. Browser sessions closed afterward. Core student used the existing personal Students-tab link and personal Core join action, not generic link. No enrollment or Core role data was changed.

The UI correctly requires approved activity selection for Play/Live engine commands; none exists yet. The real organiser panel is verified/open, but game-start disabled due to deliberately empty activity allowlist is not an identity failure. Guest participation/organiser-context JWTs were separately tested in adapter unit/browser harness with an approved fixture activity; **no actual LGU game/session was created**.

## Validation

- Clean `npm ci`, `npm run check`: **101/101 tests PASS**, zero skips; production Webpack build/SRI PASS, bundle247,935 bytes.
- Local real-SDK/browser regression: **12 checks PASS**, zero console/page errors, zero external requests. This harness remains explicitly synthetic and separate from the real results above.
- Coverage: guest no-Core-call, invalid-credential-no-fallback, malformed/self metadata, BBB authority vs Core role, stable Core principal across meetings, scoped guest principal/replay, JWTv2 null fields/mode/history/scope changes, expiry, demotion, optional enrichment failure, self-only roster minimization and all-meeting runtime guards.
- Safe live service-auth probe: **PASS**, HTTP200active:false for intentionally invalid non-personal token.
- nginx/systemd validation, restart/runtime health, boot-enabled state, syntax/whitespace/editor diagnostics: **PASS**.
- Actual service credential and private signing key exclusion from source/bundle: **PASS**, no raw secret/hash output.

## Safety, cleanup and next boundary

No real names/person IDs/join URLs/tokens/payloads recorded in this report. Temporary Core page clipboard/window.open overrides restored; automation-created student contexts closed, Teacher Workspace preserved. Current teacher panel verification was refreshed after service restart. No LGU repository/PR #46 access, Core edits, migrations, BBB core changes, account/history/scoring engine, game endpoint or game session. No Git push/public security PR.

Guest Core IDs always null, learningContextnull, historydisabled. Later organiser-selected activity/level must be carried explicitly to LGU, never derived from Core placement for a guest. Stable Core principal enables future persistent association but creates no new identity system/account automatically. The engine must honour mode/history policy and validate exchange/session/organiser scope itself.

Prepared contexts remain short-lived process-local coordination only (max5min; activity JWTmax120s). Restart safely requires fresh preparation, not seamless game continuity; canonical live sessions/persistence/idempotent commands belong to LGU in the next task. Activity catalogue selection, key rotation/HA engine rollout and operational load validation are not implemented/claimed as game features. No database migration required.

Rollback: stop/disable only LGU service; revert matched server/assets/manifest/config if needed; remove only its nginx route+rate-limit snippets together, validate/reload nginx. Keep Core credential/signing key protected. No Core/BBB core edit is needed for this rollback. Existing meetings retain captured immutable bundle; new meetings pick the hosted manifest.

**Stop here: READY FOR LGU ENGINE INTEGRATION: YES. No LGU changes or engine endpoint implemented.**