// Registers the central-dep-blocker resolution hook for the current Node
// process. Used as `node --import scripts/register-central-dep-blocker.mjs …` by
// the smoke-dist gate to load a consumer-facing entry with the 11 central-only
// devDeps made unresolvable. See central-dep-blocker.mjs for the why.
import { register } from "node:module";

register("./central-dep-blocker.mjs", import.meta.url);
