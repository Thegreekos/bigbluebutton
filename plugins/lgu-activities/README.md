# LGU Activities — Phase 1

Independent plugin package inside the BBB4 workspace. No BBB core changes, LGU repository changes, database migrations or deployment. Independent of LGU PR #46; no PR ref or unreleased LGU dependency.

## Investigated baseline

- BBB Git baseline: `9916ef7bbb`, `maintained/v4.0`; clean workspace before this branch.
- Official local reference: `docs/docs/plugins.md` and `bigbluebutton-html5/imports/ui/components/plugins-engine/`.
- **Actual Lesson Assistant source**: `/root/tgos-lesson-assistant` (external, not a Git checkout). Read-only reference: `src/registration.js`, `src/index.js`, `webpack.config.cjs`, `INSTALL.md`; validation snapshot `/srv/bbb4-validation/phase1314-20261005`.
- Reused SDK `0.1.26`, independent Webpack IIFE, host `window.React`, loader `uuid`/`pluginName` attributes, `createRoot` returning the sidekick root, versioned assets and SHA-384 manifest generation.
- One `GenericContentSidekickArea` automatically becomes one Apps menu item through BBB4's `REGISTER_SIDEBAR_APP`. **Do not additionally register an AppsGalleryEntry.**
- Compatibility range uses BBB's documented `^0.1.26` convention; Lesson Assistant currently uses `~0.1.26`. Both accept this workspace's SDK.

## Build and local verification

Run from this directory: `npm ci`, `npm run check`, then `npm run test:browser`.
`npm run build-bundle` aliases `npm run build`. Outputs: `dist/manifest.json`, `dist/releases/0.1.0/LGUActivities.js` and third-party license notices. No BBB client build/install is needed.

`npm start` serves **only on 127.0.0.1:4702**. Open `http://127.0.0.1:4702/` for the local SDK/Apps host harness. It loads the real SDK and built plugin with the official loader attributes and simulated BBB role responses. It verifies registration, open/close/reopen, keyboard interaction, role changes and no external requests. It is **not** a running BBB meeting and does not claim production acceptance. Browser tests start and stop their own ephemeral loopback server; Chromium must be installed (`npx playwright install chromium` if absent).

No environment variables, `.env`, API keys, School Core token or LGU URL are required in Phase 1. No cookies, participant identity storage, remote resources, mutations, data channels or recording events are used. Moderator role is a presentation gate, **not** proof of School Core teacher identity.

## Future controlled BBB installation — NOT performed in Phase 1

Like Lesson Assistant, assets can eventually be hosted separately on the BBB HTTPS origin under `/plugins/lgu-activities/`. Install immutable release files before switching the root manifest; keep matching bundle/SRI/manifest together. Do not overwrite Lesson Assistant assets. This generated SRI assumes same-origin hosting (the current BBB loader does not set `crossorigin` for cross-origin SRI).

Activate in **one explicitly authorized test meeting only**, via `/create` parameter `pluginManifests=[{"url":"https://<bbb-host>/plugins/lgu-activities/manifest.json"}]`. BBB merges plugin sources, so preserve other required meeting plugins. A fresh meeting captures the manifest. No global `bbb-web.properties` or `bbb-html5.yml` edit is required for this shell, and no service restart is needed for static assets. Do not copy assets to `/var/www`, change nginx/configuration, or activate meetings during this phase.

Real BBB acceptance remains a separate controlled gate: moderator sees exactly one LGU Activities item in Apps; viewer sees none; panel opens/closes/reopens with Μαθαίνω, Παίζω, Live; role demotion removes the entry. Verify alongside Lesson Assistant without affecting it.

## Scope

All three choices show local “not connected yet” notices. No question selection, game/session start, scoring or mastery logic is implemented. See `ARCHITECTURE.md` for the first Live vertical slice boundary.