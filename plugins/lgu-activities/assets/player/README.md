# Canonical LGU Live player artifact

The immutable subdirectory `56e438e67c977113bcbd513591d440b2b140e893/` was built from LGU `main` at the merge commit for PR #50. It is the only player pin used by the BBB plugin.

Re-stage from a clean checkout of that exact LGU commit with:

`npm run stage:player -- --source <LGU-checkout>/dist/player --commit 56e438e67c977113bcbd513591d440b2b140e893`

The staged files are generated bundle assets, not copied LGU React components. Do not update the pin or install these assets into production during the visual approval phase.
