// Registers the dev-dep-blocker resolution hook for the current Node process.
// Used as `node --import scripts/register-dev-dep-blocker.mjs …` by the
// smoke-dist gate. See dev-dep-blocker.mjs for the why.
import { register } from "node:module";

register("./dev-dep-blocker.mjs", import.meta.url);
