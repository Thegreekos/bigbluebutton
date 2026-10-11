# LGU Activities 0.4.1 — isolated layout/stream renewal follow-up

## Boundaries

Changes belong only to this independent plugin on BBB PR1's existing `feat/lgu-activities-plugin` branch. No BBB core, School Core, production plugin, global manifest, federation issuer or secret change. No PR merge, real meeting or LGU game is authorized in this phase. The canonical player remains pinned byte-for-byte to `56e438e67c977113bcbd513591d440b2b140e893`.

## Layout root cause and fix

BBB's existing generic-content slot is height100%/overflowhidden over the presentation. Our previous player host had auto height and transparent unused space: a ~701px reveal exceeded a ~387px real slot, clipping standings; short prepare content left the underlying presentation visible. SDK0.1.26 GenericContentMainArea has no hidePresentation property; BBB owns stacking and removes the generic item at Finish.

`src/player-stage.js` now renders plugin-scoped host CSS alongside the real player: width/height100%, min-width/min-height0, opaque background, native overflowauto with contained overscroll and keyboard focus. The host covers the slot and scrolls the unchanged LGU content. No BBB DOM selectors/layout mutations or document-wide overrides are used. Removing the main item at Finish unmounts host/styles and restores the BBB presentation through the existing SDK lifecycle.

The moderator-only sidekick remains controller-only and is itself height-bounded/scrollable on compact screens. Its useState precedes nullable snapshot returns so teardown/recovery retains hook order. No explicit duplicate Apps entry is added.

## SSE diagnosis and fix

Controller POST `live/stream` intentionally has a20s server lifetime for renewed proof verification. Native player GET streams have their existing longer cap; these are distinct transports. Previously every controller EOF incremented the reconnect attempt, so repeated healthy 20s windows inevitably became permanent3s polling after four attempts.

The browser controller now distinguishes an orderly EOF after a valid event from an empty EOF/network failure. Healthy completion reconnects after1s with failure count reset and current cursor, going through the same BFF/proof verification. Empty streams/network failures retain1s/2s/4s retries then3s polling. Invalid events/401/403/409 fail closed as before. No command/answer retry is introduced, no long-lived authorization window is extended, and no endpoint permissions/signing/credential changes occur.

SSE/media backpressure waits now release both drain/close listeners and the abort listener when any wins, preventing accumulated listeners and ensuring cancellation releases a blocked drain. HTTP streams still cancel upstream readers on disconnect/deadline. Continuous real-network SSE remains a next-meeting acceptance item, not a local test claim.

## Tests

Build before clean-check execution (`npm run build`, then `npm run check`); the existing player-stage test needs a generated local manifest. `npm run test:browser` uses the real built plugin/SDK/canonical player and HTTP BFF with **mock BBB/Core/LGU data** on loopback only. It is not a real visual-approval meeting.

The local host now mirrors a bounded overflowhidden generic slot layered above a still-mounted board, not the previous auto-height test shortcut. Responsive assertions cover teacher/student in prepare/open/reveal at1150×536,1440×900,1024×768 and768×1024: full opaque slot coverage, no horizontal overflow, keyboard scroll and reveal standings reachable. Finish restores the board in both roles; viewer has no sidekick, no iframe/new tab/storage/credential exposure.

Unit regressions cover repeated healthy EOF renewals without polling, empty EOF and network failure fallback, auth/error stop, stop/dispose timer cleanup, nullable controller snapshot recovery, exact20s server cancellation,25 backpressure drain cycles without losing-listener buildup, and abort while drain-blocked.

## Moderator message

The no-answer message remains a canonical LGU issue, not a BBB-local copy to override. See `LGU_PLAYER_HOST_HANDOFF.md` for the exact source-mapped location, requested host-versus-participant distinction, and LGU acceptance tests. No spectator-role workaround or DOM text hiding was implemented.

## Canary release and rollback requirements

Use only existing canary paths/service4704 and `/api/lgu-activities-canary/v1/`. Stage the plugin0.4.1 from the reviewed BBB branch commit with deployment-only API/player-base/config-path/port substitutions outside Git. Keep canonical player bytes identical, reuse existing protected secret/signing/Core files read-only, and never copy secrets into backups/assets. Publish new `releases/0.4.1` assets with recomputed SRI and switch only the canary manifest. Preserve0.4.0 assets and back up canary runtime/non-secret config/manifest before switching. Restart only the canary if installing relay changes; nginx/unit/routes need no update or reload.

Rollback must guard the expected current version/hashes, restore the matching old canary runtime/config/manifest from an integrity-checked backup, restart only canary, verify4704healthready and unchanged production PID/config/assets hashes. Do not restore production files or touch existing secret files. Deployment evidence/rollback live outside Git under `/srv/bbb4-validation/`.

## Next real acceptance — user approval required

Keep School Core cleanup/unset state unchanged. The owner must approve and enable scoped canary only for a fresh authorized lesson, create/open it through the normal Core flow and share teacher plus personal-student BBB sessions. Before any new game, verify official loader version0.4.1/SRI and pinned player, both roles, production invariants and rollback. Then verify real prepare/open/reveal scroll/standings and no whiteboard overlap at desktop and tablet (including small teacher viewport), controller-only host/no student sidekick, successful answer/score/standings, repeated20s healthy stream renewals versus actual failure/poll fallback, and Finish restoration in both tabs. New real screenshots are required; local mock tests do not grant visual approval. No meeting or real upstream launch is performed in this phase.
