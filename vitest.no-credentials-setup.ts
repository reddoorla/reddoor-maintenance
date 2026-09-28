import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripCredentials } from "./vitest.credential-env.js";

stripCredentials(process.env, mkdtempSync(join(tmpdir(), "reddoor-no-credentials-")));
