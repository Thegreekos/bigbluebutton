# Canonical LGU Live player artifact

The active immutable subdirectory is `df7ad50bbe6aa46c8c0aef576eef745185dbb76b/`, from LGU main PR #53's merge. Official successful main CI run: `38123134346`; artifact: `lgu-live-player-df7ad50bbe6aa46c8c0aef576eef745185dbb76b`. The previous PR #50 artifact is retained for history, not referenced by the active plugin.

Stage only the official CI artifact after verifying successful main/head SHA, archive digest, `COMMIT` and `sha256sum -c SHA256SUMS` (13 files):

`npm run stage:player -- --source <verified-official-artifact> --commit df7ad50bbe6aa46c8c0aef576eef745185dbb76b`

The stager validates COMMIT, all 13 checksums and manifest sizes/set, preserving checksum metadata. It refuses non-identical immutable collisions. These are generated bundle assets, not copied LGU React components. Only isolated canary deployment is authorized; no production replacement.
