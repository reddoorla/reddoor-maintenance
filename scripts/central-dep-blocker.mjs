// Node module-resolution hook used by the smoke-dist gate to PROVE the
// consumer-facing entries (the CLI bin + ./forms + ./configs/*) never statically
// import a "central-only" package.
//
// Those 11 packages are devDependencies of @reddoorla/maintenance: a consuming
// fleet site installs the package only for ./forms + ./configs/* and runs
// `reddoor-maint audit --only a11y` in CI, so it never installs them. If any
// consumer-facing entry eagerly (statically) imported one, it would crash at
// load in the consumer's CI — the exact regression this guard exists to prevent.
//
// Registered via scripts/register-central-dep-blocker.mjs (`node --import …`),
// this hook makes the 11 packages UNRESOLVABLE. Loading an entry under it then
// reproduces a consumer's install exactly: if the entry's real static import
// graph reaches a central-only dep, resolution throws; if it's clean, it loads.
// Because it uses Node's actual resolver over the actual graph — not a source
// scan — it can't be fooled by how esbuild happens to format an import (the trap
// the earlier regex-based gate fell into: it missed multi-line imports entirely).
export const CENTRAL_ONLY_DEPS = [
  "mjml",
  "resend",
  "airtable",
  "@google-analytics/data",
  "google-auth-library",
  "@libsql/client",
  "@libsql/kysely-libsql",
  "kysely",
  "sharp",
  "svix",
  "@lhci/cli",
];

const blocked = new Set(CENTRAL_ONLY_DEPS);

function topLevelPackage(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

export async function resolve(specifier, context, nextResolve) {
  // Only bare (node_modules) specifiers can be a central-only dep. Relative,
  // absolute, and node: builtins always pass straight through.
  const isBare =
    !specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("node:");
  if (isBare && blocked.has(topLevelPackage(specifier))) {
    throw new Error(
      `[central-dep-blocker] refused to resolve central-only dep "${specifier}" — a ` +
        `consumer-facing entry must not statically import it (it is a devDependency a ` +
        `consuming fleet site never installs).`,
    );
  }
  return nextResolve(specifier, context);
}
