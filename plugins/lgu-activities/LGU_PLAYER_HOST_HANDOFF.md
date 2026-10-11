# LGU handoff: canonical host reveal copy

## Resolved upstream; integration pending real scoped retest

LGU PR #53 merged on main at `df7ad50bbe6aa46c8c0aef576eef745185dbb76b`.
BBB plugin0.4.2 stages its official successful CI run38123134346 artifact after COMMIT and13SHA256SUMS checks. The new canonical renderer uses `liveViewer` to distinguish host/player/audience, shows the host organiser badge and public reveal/counts/standings, and omits the personal no-answer card for host. Normal BBB mounts now omit the spectator prop; explicit spectatortrue behavior remains. The historical diagnosis below applies to the previous pin, not the new active artifact. Actual new-meeting visual approval is still required.

## Verified provenance and reproduction

BBB keeps the canonical player artifact at LGU commit `56e438e67c977113bcbd513591d440b2b140e893` byte-identical. Its committed source map identifies **`app/screens/live-play-screen.tsx`** as the original screen responsible for the copy.

Real authorized Odyssey canary E2E on 2026-10-10: moderator receives `session.role: 'host'`, `session.me:null`, `session.own:null`; a student answers correctly and the authoritative reveal has points105 and standings rank1/total105. The moderator's main player incorrectly displays **Δεν απάντησες σε αυτή την ερώτηση. / You did not answer this question.** The moderator is intentionally not a player. This is not an identity failure or a controller-panel renderer.

In the source-mapped reveal branch, `spectator` selects a public answered count; otherwise a `live-own` Card renders `session.own` or the no-answer message. That otherwise branch also catches the authenticated host. BBB intentionally passes `spectator:false` for normal host/participant views; changing it to true would conflate host and audience semantics.

## Requested LGU change (not implemented in BBB)

In `LivePlayScreen`'s reveal branch:

- Distinguish authoritative `session.role === 'host'` from `session.role === 'participant'`.
- Hosts get a neutral public answered/eligible count or a host summary, not participant correctness/points/no-answer copy. Keep the canonical standings visible.
- Participants retain the existing own-answer card, including **did not answer** when genuinely unanswered, and actual engine-supplied correctness/points when answered.
- Keep spectator/audience rendering free of personal data, independently of the host branch.
- Preserve Greek/English locale support; do not duplicate scoring or alter the engine response/permissions.

## LGU acceptance tests

1. Host, `spectator:false`, reveal, `me:null`, `own:null`: no Greek/English did-not-answer copy; public counts and standings shown.
2. Answered participant: own result, correct/incorrect rendering, points and standings unchanged.
3. Unanswered participant: did-not-answer copy remains.
4. Spectator: public reveal/counts, no personal own-result card or participant controls.
5. Lobby/prepare/open/closed/reveal/finished host lifecycle remains valid; no role inferred from display name or browser request.

LGU should build/test the reusable player and provide the reviewed canonical commit plus full artifact manifest/integrity. BBB can then deliberately update the pin in a separately authorized phase and rerun host/participant/browser/canary E2E. No LGU repository, player bundle/CSS, source-map content or pin was modified here; this document is the handoff, not a claimed upstream fix.
