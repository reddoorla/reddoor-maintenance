import { CREDENTIAL_ENV } from "./vitest.credential-env.js";

for (const name of Object.keys(process.env)) {
  if (CREDENTIAL_ENV.test(name)) delete process.env[name];
}
