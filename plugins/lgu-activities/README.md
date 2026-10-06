# LGU Activities — Production participant integration (0.3.0)

**Current:** official loader + real Core/guest acceptance passed. `bbb-lgu-activities` is running and enabled for boot for all verified BBB meetings, not one acceptance lesson. Core association is optional; verified BBB moderator controls organiser authority. Read [`IDENTITY_V2.md`](IDENTITY_V2.md) and [`PRODUCTION_MODES_ACCEPTANCE.md`](PRODUCTION_MODES_ACCEPTANCE.md). The remainder of this README documents previous 0.2.0 operations where marked; v2 is authoritative.

## Current production operation

- Runtime: `/usr/local/bigbluebutton/lgu-activities`, root-managed; service user `bigbluebutton`, loopback `127.0.0.1:4703`, enabled systemd unit, no privileges/capabilities, read-only system/home isolation.
- Host config `/etc/bigbluebutton/lgu-activities/adapter.json`: `origin: https://meet.thegreekos.com`, `meetingScope: all-verified-bbb`, `allowedActivityIds: []` until an approved engine activity selection is wired. No lesson IDs or browser identity assertions. Health reports modes core/guest.
- Core secret fixed file0600, parent0700. Guest calls do not read it or call Core. Existing signing key reused; no new credential or identity issuer.
- Deploy templates: `deploy/bbb-lgu-activities.service`, `deploy/lgu-activities.nginx`, HTTP-context `deploy/lgu-activities-rate-limit.conf`. Install both nginx snippets together, validate nginx before reload. Only exact routes proxied, no request logs/cache, IP rate limit30/s burst60; no static exposure of `/etc`.
- Built official release is `dist/releases/0.3.0/LGUActivities.js` + generated manifest/SRI; hosted manifest at `/plugins/lgu-activities/manifest.json`. Core now supplies both LGU and Lesson Assistant manifests on new BBB4 `/create` (already done by Core owner; no Core edit here). No script injection, database mutation or BBB core changes.
- Build/check: `npm ci`, `npm run check`, `npm run test:browser`. Local guest organiser demo: `npm start -- --identity-fixtures`, `/?identity=guest` (synthetic demo, never production evidence).
- Explicit optional actual guest check: `node scripts/verify-live-guest.cjs --live-guest-check --meeting <approved-existing-external-meeting>`; `--organiser-check` additionally creates a real BBB-only moderator for panel acceptance. This administrative tool uses existing BBB server API configuration in memory, no Core userdata/student accounts, no game, no credential/URL logging; it closes its browser session. Use only in an authorized meeting, not automatic tests.
- Rollback/stop: disable/stop only `bbb-lgu-activities`, restore the matched previous server/assets/config if needed; remove only its nginx route and rate-limit files together, test/reload nginx. Never delete/print shared Core credential or signing key. Service restart intentionally expires transient prepared contexts; nothing is persisted as student history or a game.

Core participants receive own authorized role/placement/context when available and stable Core association. Guests receive temporary meeting/participant identity, null Core IDs/context and history disabled. Moderator can open the organiser panel with or without Core; activity selection is required before an engine command. Learn/Play/Live remain integration shell; **no engine/game is implemented**. READY refers to the boundary for the next LGU-engine implementation only.

## Historical 0.2.0 notes (superseded where conflicting)

Independent plugin package inside the BBB4 workspace. No BBB core changes, LGU repository changes or database migrations. Independent of LGU PR #46; no PR ref or unreleased LGU dependency.

Phase 2 continues from `f21c4e1ab0` on `feat/lgu-activities-plugin`. Current evidence is `SCOPED_ACCEPTANCE.md`: **real Teacher / Student A / Student B, different canonical identities, cross-student misuse and reload/reconnect passed** through the running scoped adapter. Full READY remains NO: true non-Core guest and officially loaded LGU Live UI checks remain blocked. Earlier phase reports are historical; fixtures do not substitute for those gates.

## Investigated baseline

- BBB Git baseline: `9916ef7bbb`, `maintained/v4.0`; clean workspace before this branch.
- Official local reference: `docs/docs/plugins.md` and `bigbluebutton-html5/imports/ui/components/plugins-engine/`.
- **Actual Lesson Assistant source**: `/root/tgos-lesson-assistant` (external, not a Git checkout). Read-only reference: `src/registration.js`, `src/index.js`, `webpack.config.cjs`, `INSTALL.md`; validation snapshot `/srv/bbb4-validation/phase1314-20261005`.
- Reused SDK `0.1.26`, independent Webpack IIFE, host `window.React`, loader `uuid`/`pluginName` attributes, `createRoot` returning the sidekick root, versioned assets and SHA-384 manifest generation.
- One `GenericContentSidekickArea` automatically becomes one Apps menu item through BBB4's `REGISTER_SIDEBAR_APP`. **Do not additionally register an AppsGalleryEntry.**
- Compatibility range uses BBB's documented `^0.1.26` convention; Lesson Assistant currently uses `~0.1.26`. Both accept this workspace's SDK.

## Build and local verification

Run from this directory: `npm ci`, `npm run check`, then `npm run test:browser`.
`npm run build-bundle` aliases `npm run build`. Outputs: `dist/manifest.json`, `dist/releases/0.2.0/LGUActivities.js` and third-party license notices. No BBB client build/install is needed. Signing service and fixtures are not bundled into the browser plugin.

`npm start` serves **only on 127.0.0.1:4702**, without an identity backend by default; Live is locked. For an explicit **synthetic-only** demo, `npm start -- --identity-fixtures`, then open `http://127.0.0.1:4702/?identity=fixture`. This opt-in generates ephemeral signing keys and fake BBB/Core proof registries; never mount these fixtures in a real backend. The real SDK, generated manifest/SRI, built plugin and signed adapter run locally, while BBB roles/metadata/presence and Core credential validation are simulated. This is **not** a BBB meeting. Browser tests start and close their own ephemeral loopback server; Chromium must be installed (`npx playwright install chromium` if absent).

No environment variables or `.env` are required for local fixtures. Production construction requires explicit trusted providers and server-only signing keys; there are no default production secrets or permissive Core provider. The plugin uses only self-scoped `schoolcore_context_token`, SDK `getSessionToken`, and fixed **same-origin** adapter routes. It reads no other user's credential and uses no token storage. BBB cookie forwarding is limited to the trusted BBB auth hook; Core reads omit cookies. Moderator role alone is **not** School Core teacher authority.

`server/production-integration.cjs` exposes `createProductionIdentityService` with explicit BBB hook URL, activity allowlist and activity-signing keys/issuer/audience/kid. It uses `server/core-introspection.cjs` for request-scoped live token introspection at the fixed Core endpoint. The service credential is read only on the server from the protected fixed `/etc/bigbluebutton/lgu-activities/classroom_introspection_token`, with file type/owner/mode/size checks. It is not a plugin setting, environment variable, manifest property or browser module. No new service credential was generated. Do not paste either credential into logs or public bug reports.

For an explicitly authorized, non-personal live **service authentication only** check, run `scripts/probe-core-service-auth.cjs --live-service-auth-only` using Node as `bigbluebutton`. It sends intentionally invalid token/fictional bindings, requires `HTTP 200 active:false`, and prints only sanitized PASS/FAIL. It is not teacher/student acceptance and must not be used to mint identity.

## Scoped installation and remaining plugin gate

Built assets are hosted on the BBB HTTPS origin under `/plugins/lgu-activities/` (immutable release `0.2.0` + matching manifest/SRI). Lesson Assistant assets remain unchanged. This generated SRI assumes same-origin hosting (the current BBB loader does not set `crossorigin` for cross-origin SRI).

Before activation use the implemented real Core introspection composition, confirm normal context meeting binding, mount `server/http-handler.cjs` behind the BBB HTTPS origin, configure existing activity-signing keys/key rotation/rate limits/context storage, and select a server-approved `liveActivityId` through existing per-plugin settings. The Core token's current participant binding is derived from the independently authenticated BBB session after successful introspection, not a new pre-join Core claim. No migration is assumed. Stop for schema review if existing backend storage cannot support the integration without one.

The running `bbb-lgu-activities` service is loopback `127.0.0.1:4703`, `User=bigbluebutton`, hardened, installed but not enabled for boot. Root-managed runtime is `/usr/local/bigbluebutton/lgu-activities`; config `/etc/bigbluebutton/lgu-activities/adapter.json` restricts the verified external meeting ID to one Portal lesson. Empty allowed activity list deliberately prevents game/context creation until an approved catalog ID exists. `/healthz` is loopback-only; nginx forwards only the five fixed identity routes, with access log and proxy cache disabled. No global manifest/config or BBB core restart.

The current Portal room was created with Lesson Assistant only. Official BBB plugin activation requires Core's scoped `/create` parameter `pluginManifests=[{"url":"https://<bbb-host>/plugins/lgu-activities/manifest.json"}]`, preserving other required plugins, plus non-secret per-plugin `liveActivityId` and matching server-approved activity allowlist. A fresh meeting captures the manifest. There is no supported existing-meeting plugin insertion API; do not mutate DB, inject scripts manually or enable globally to claim a UI pass. Core source is not mounted here; this remaining caller change is not applied.

Rollback: stop `bbb-lgu-activities`; remove only `/etc/bigbluebutton/nginx/lgu-activities.nginx` after `nginx -t` and reload nginx. Remove scoped manifest from the Core caller for future meetings. Installed public assets/unit may remain inert; preserve existing Core service credential and activity signing key (never print/delete them blindly). To freeze acceptance without removal set `allowedMeetingIds: []` in protected host config and restart only this adapter. No migration or BBB package rebuild.

Real BBB acceptance remains a separate controlled gate: moderator sees exactly one LGU Activities item in Apps; viewer sees none; panel opens/closes/reopens with Μαθαίνω, Παίζω, Live; role demotion removes the entry. Verify alongside Lesson Assistant without affecting it.

## Scope

Μαθαίνω/Παίζω remain placeholders. Live prepares a server-validated **activity context only**, after canonical teacher verification; it does not start an LGU session. Teacher sees Core roster IDs matched to BBB observed stable extIds, clearly distinguished from per-student verified activity credentials. Each student's exchange is self-only. Unknown/guest/Test Room credentials fail closed. No question selection, answers, scoring or mastery logic exists. `VALIDATION.md` is the historical Phase 1 report; `PHASE2_VALIDATION.md` records current evidence and blocked real acceptance. `LGU_HANDOFF.md` specifies the exact next backend capabilities, without claiming uninspected LGU endpoint/file names.