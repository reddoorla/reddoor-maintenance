---
"@reddoorla/maintenance": patch
---

fix(fleet): the fleet write-back now emits a machine-readable `FLEET_WRITE_SUMMARY wrote=N failed=M total=T` line so the nightly workflow can gate on real outcomes (red on total/mass write-back failure, warn on a tolerated single flake) instead of a "wrote ≥ 1" heuristic.
