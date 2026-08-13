// The public surface of the Prismic model pipeline: the pure comparison core
// (canon, diff), the three adapters that touch the outside world (config and
// local read the repo, remote reads and writes Prismic, write puts a model back
// on disk), the token rule, and the push that drives them.
//
// EVERY EXPORT HERE IS ALSO AN ASSERTION. `tests/prismic/models/index.test.ts`
// pins this list, and the capability guard in that file allow-lists the exact
// bindings each `from` clause may take — so adding `deleteModel` here reddens
// the suite twice over, by name and by capability. That is deliberate: this
// module is the one whose whole design rests on a stale local checkout being
// UNABLE to remove a live content model, and the export list is the narrowest
// place to see the whole surface at once. Read the guard's header before
// changing anything below.
export { canon, sameModel } from "./canon.js";
export { describeDiff, diffModels, withRemoteScreenshots } from "./diff.js";
export { readPrismicConfig, type PrismicConfig } from "./config.js";
export { prismicTokenEnvName, resolvePrismicToken, type ResolvedToken } from "./token.js";
export { localModels } from "./local.js";
export { CUSTOM_TYPES_API, remoteModels, sendModel } from "./remote.js";
export { pushModels, type PushOptions, type SendFn } from "./push.js";
export { modelFilePath, writeModelFile, type WriteResult } from "./write.js";
export type {
  LocalEntry,
  ModelDiff,
  ModelKind,
  PrismicModel,
  PushReport,
  RemoteEntry,
} from "./types.js";
