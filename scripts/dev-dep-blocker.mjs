// Node module-resolution hook used by the smoke-dist gate to load the built
// package the way a consuming fleet site installs it: only `dependencies` and
// `peerDependencies`. Every devDependency that is not also one of those is made
// unresolvable, so an import the source reaches through a dev-only package
// fails here as it would in a consumer's CI (#1607: `renovateActionGaps` parses
// with js-yaml, which had been dev-only; tsup externalizes devDependencies, so
// the build alone never shows it).
//
// central-dep-blocker.mjs blocks a named ten for entries that must stay light;
// this one blocks them all, for commands that legitimately use runtime deps.
// Registered via scripts/register-dev-dep-blocker.mjs (`node --import …`).
//
// Its blind spot, shared with central-dep-blocker: a CommonJS `require` (or
// `createRequire`) does not pass through this ESM hook. dist is ESM with no
// `createRequire`, so every first-party import does.
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
// An optional peer (`@sveltejs/kit`) may be absent from a consumer's install.
const optionalPeers = Object.entries(pkg.peerDependenciesMeta ?? {})
  .filter(([, meta]) => meta?.optional)
  .map(([name]) => name);
const installed = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}).filter((p) => !optionalPeers.includes(p)),
]);
const blocked = new Set(Object.keys(pkg.devDependencies ?? {}).filter((d) => !installed.has(d)));

function topLevelPackage(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

export async function resolve(specifier, context, nextResolve) {
  const isBare =
    !/^[./]/.test(specifier) && !specifier.startsWith("node:") && !specifier.startsWith("file:");
  if (isBare && blocked.has(topLevelPackage(specifier))) {
    throw new Error(
      `[dev-dep-blocker] refused to resolve "${specifier}": it is a devDependency, which a ` +
        `consuming site never installs. Move it to dependencies, or keep it off this path.`,
    );
  }
  return nextResolve(specifier, context);
}
