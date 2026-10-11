# BBB plugin0.4.2 — official LGU PR53 main artifact

## Provenance and pin

- LGU main merge SHA: `df7ad50bbe6aa46c8c0aef576eef745185dbb76b` (PR53).
- Official GitHub Actions run: `38123134346`, verified `status:completed`, `conclusion:success`, `head_branch:main`, exact headSHA.
- Artifact: `lgu-live-player-df7ad50bbe6aa46c8c0aef576eef745185dbb76b`.
- Official archive digest verified when supplied by GitHub; authenticated download credential held only in memory and omitted from storage redirect.
- `COMMIT` equals the pinnedSHA; **`sha256sum -c SHA256SUMS` passes all13entries**, including COMMIT,11manifest-listed bundle/CSS/types/map/fonts andmanifest. SHA256SUMS itself is retained as additional verificationmetadata, not miscounted as a14th checksummedpayload.

Only generated official artifact bytes are staged at `assets/player/<newSHA>/`. No local player rebuild, copied React screen, bundle patch or CSS change. Old immutable PR50assets remain retained for history/capturedclients; the active browser/stager/localhost references only newSHA.

The stager now requires COMMIT/13checksumentries, matching manifestfile-set/sizes and identicalbytes on immutable restaging; corruptedbytes/wrongpin/wrongCOMMIT are rejected before copying.

## Host and spectator contracts

Normal BBB moderator/learner mounts **omit the spectator prop**. LGU's `liveViewer` selects the actual authoritative host/player view from `session.role`/`me`, rather than BBB disguising the moderator as spectator. Explicit `spectator:true` is preserved for the existing audience path, with audio disabled as before.

The new canonical renderer shows host badge Διοργανωτής, disabled read-only options/no submit, public reveal/counts/standings and no personal no-answer card. The previous `LGU_PLAYER_HOST_HANDOFF.md` is marked resolved upstream; actual scoped visual retest remains pending.

## Preserved0.4.1 work

Full-slot opaque bounded scrolling host, keyboardscroll/focus, moderator-only controller and stablehooks, immutableplayerloading, currentBBB/Core proof forwarding and Finishpresentationrestore are retained. SSE validEOFrenewal/20sauthwindow/failurefallback/backpressurecleanup unchanged byte-for-byte from the previous BBBcommit where applicable. No BBBcore/SchoolCore/productionplugin/LGUserver change.

## Tests and boundaries

- Clean npmci, buildfirst, npmruncheck: **211/211testsPASS**,0fail/skip.
- Build/SDK/manifest/SRI checksPASS; new immutable `releases/0.4.2/LGUActivities.js`.
- Browser harness: real built BBBplugin/SDK/newofficialplayer +realHTTPBFF with **mock BBB/Core/LGU data**, not a real meeting.
-24responsivecases: teacher/student prepare/open/reveal at1150×536,1440×900,1024×768,768×1024. Fullslotcoverage/nohorizontaloverflow/reachablekeyboardscrollstandings.
- Hostbadges/read-onlyoptions/noanswer-submit/publicreveal/counts/standings/noincorrectpersonalcopy; learnerownresultunchanged; explicit spectatorcontractregression.
- ExistingFinishreturnsbothroles toboard/no studentsidekick/noiframe/noexternalgamewindow/storage/proofleakage regressionsPASS. SSEtestsretained.

## Isolated canary only

Back up currentcanary0.4.1runtime/nonsecretconfig/assets with integrityguards and offline rollbackrehearsal. NewBBBcommit build gets onlycanaryAPI/player-base/config-path/port substitutions outsideGit. Install newplayerSHAassets andrelease0.4.2 without overwritingoldimmutablefiles. Switch onlycanarymanifest withrecomputedSRI, updatecanarypackage/configcommit, restartonlycanary4704 ifneeded. Existingprotectedissuer/secret reused unchanged, no copies/rotation/newissuer. ProductionPID/health/config/assets/runtime/nginxbaseline mustremainunchanged.

Deployment evidence and rollback stay outsideGit in `/srv/bbb4-validation/lgu-player-042-20261011/`. No public/globalCoremanifest activation, BBBcoreedit, SchoolCoreenvchange, productiondeployment or PRmerge. **Stopbefore nextrealmeeting**. READY_FOR_CORE_SCOPED_RETEST refers verifiedcanary/readiness, not ownervisualapproval or newrealE2E.

Next: ownerauthorizesfreshscopedlesson and shares teacher/personalstudenttabs; verify official0.4.2SRI/newpin thenrealhostreveal/standings, responsiveclipping/opaquestage, SSErenewal/fallback andFinishboardrestore withnewactualscreenshots.
