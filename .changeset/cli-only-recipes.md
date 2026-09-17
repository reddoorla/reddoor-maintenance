---
"@reddoorla/maintenance": minor
---

Breaking (package surface): `healthEndpoint`, `smokeSuite` and `matchHarness` are no longer exported from the package entry point (`@reddoorla/maintenance`) or the recipe barrel. They are CLI-only — `reddoor-maint health-endpoint`, `reddoor-maint smoke-suite`, `reddoor-maint match-harness` and `init` keep working unchanged, and the names stay in `ALL_RECIPE_NAMES`. The exports were added in 0.x as a stopgap (#803) pending this decision (#731); a search of every fleet checkout found no consumer importing any of the three.
