---
"@reddoorla/maintenance": patch
---

### Internal: `withRecipe(...)` wrapper consolidates the boilerplate every recipe used to re-implement

Closes debt item #15 from the deep-review backlog. Pure refactor — no behavior changes (every existing recipe test passes unchanged).

Every recipe used to hand-roll: site-label resolution, working-tree clean check, branch name + branch creation, commit-with-message + SHA accumulation, and the `RecipeResult` object literal for each of `noop` / `failed` / `applied`. That pattern is now centralised in `src/recipes/_with-recipe.ts`:

```ts
export async function syncConfigs(site, opts): Promise<RecipeResult> {
  // ... compute targets ...
  return withRecipe({
    name: "sync-configs",
    site,
    plan: async () => {
      const diffs = await planTemplateDiffs(...);
      if (nothing) return { kind: "noop", notes: "..." };
      return { kind: "apply", plan: { diffs } };
    },
    apply: async ({ diffs }, { commit }) => {
      for (const t of diffs) {
        await writeFile(...);
        await commit(`chore: sync ${t.config} ...`);
      }
      return { kind: "ok" };
    },
  });
}
```

Plan runs first — read-only by default, so most recipes can `noop` on a dirty tree without throwing. `bump-deps` opts into `checkTreeFirst: true` because its plan runs `pnpm install` to get an accurate `outdated` probe and would otherwise pollute a dirty tree silently.

### Numbers

- 6 recipes refactored (`sync-configs`, `bump-deps`, `convert-to-pnpm`, `onboard`, `svelte-codemods`, `svelte-4-to-5`)
- ~142 lines of duplicated boilerplate removed across recipe files
- One new internal module (~114 lines) holding the shared logic
- Net: smaller, more focused recipe modules; new recipes can be added with significantly less ceremony
- 268 / 268 tests pass without modification — the existing per-recipe specs are the spec for this refactor
