# LGU Activities — Phase 2 identity preparation

Independent plugin package inside the BBB4 workspace. No BBB core changes, LGU repository changes, database migrations or deployment. Independent of LGU PR #46; no PR ref or unreleased LGU dependency.

Phase 2 continues from `f21c4e1ab0` on `feat/lgu-activities-plugin`. It adds a server-only reference identity adapter and a teacher panel client. **Production Core token verification is not available in this workspace; real teacher/student acceptance is blocked, not simulated as a pass.** See `IDENTITY_CONTRACT.md` and `PHASE2_VALIDATION.md`.

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

## Future controlled integration — NOT performed

Like Lesson Assistant, assets can eventually be hosted separately on the BBB HTTPS origin under `/plugins/lgu-activities/`. Install immutable release files before switching the root manifest; keep matching bundle/SRI/manifest together. Do not overwrite Lesson Assistant assets. This generated SRI assumes same-origin hosting (the current BBB loader does not set `crossorigin` for cross-origin SRI).

Before activation the Core owner must implement/review `verifyCoreCredential` against actual token issuance and current membership, ensure normal context responses provide meeting binding, mount `server/http-handler.cjs` behind the BBB HTTPS origin with the real BBB hook/Core reader, configure signing/key rotation/rate limits and context storage, and select a server-approved `liveActivityId` through existing per-plugin settings. No migration is assumed. Stop for schema review if existing backend storage cannot support the integration without one.

Only then authorize one test meeting via `/create` parameter `pluginManifests=[{"url":"https://<bbb-host>/plugins/lgu-activities/manifest.json"}]`. Preserve other required plugins. Do not change global activation. A fresh meeting captures the manifest. No asset copying, backend mounting, nginx/config change, service restart or meeting activation occurs in this phase.

Real BBB acceptance remains a separate controlled gate: moderator sees exactly one LGU Activities item in Apps; viewer sees none; panel opens/closes/reopens with Μαθαίνω, Παίζω, Live; role demotion removes the entry. Verify alongside Lesson Assistant without affecting it.

## Scope

Μαθαίνω/Παίζω remain placeholders. Live prepares a server-validated **activity context only**, after canonical teacher verification; it does not start an LGU session. Teacher sees Core roster IDs matched to BBB observed stable extIds, clearly distinguished from per-student verified activity credentials. Each student's exchange is self-only. Unknown/guest/Test Room credentials fail closed. No question selection, answers, scoring or mastery logic exists. `VALIDATION.md` is the historical Phase 1 report; `PHASE2_VALIDATION.md` records current evidence and blocked real acceptance. `LGU_HANDOFF.md` specifies the exact next backend capabilities, without claiming uninspected LGU endpoint/file names.