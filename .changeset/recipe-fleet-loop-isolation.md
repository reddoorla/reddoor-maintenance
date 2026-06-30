---
"@reddoorla/maintenance": patch
---

Fix: a single failing site no longer aborts a whole `--fleet` recipe run. The fleet commands `self-updating`, `sync-configs`, `onboard`, `convert-to-pnpm`, and `bump-deps` each looped `for (const s of sites) results.push(await recipe(s))` with no per-site error handling. The recipes throw on a non-clean working tree (and on transient git errors), so the first site with a dirty checkout threw out of the loop and every subsequent site was silently never processed — surfacing as a crash rather than a per-site report. A new shared `runRecipeOverSites(recipe, sites, run)` helper runs the recipes sequentially (they do git/filesystem work) and isolates each site: a throw becomes a `failed` RecipeResult so the rest of the fleet still runs. This mirrors the isolation `prepareFleetSites` already provides for the clone/prep phase, one layer up at recipe execution.
