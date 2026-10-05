import { findFreePort } from "./free-port.js";

/**
 * How many times an audit starts its server before it reports the collision.
 * `findFreePort` releases its socket before the server binds, so another
 * process can take the port in between (#1066's `build`, 2026-09-30:
 * `EADDRINUSE … port: 40937`). A fresh port almost always clears it; a third
 * collision in a row is not a race, and the audit fails naming it.
 */
export const PORT_ATTEMPTS = 3;

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether a server's output says that `port`, one the audit picked, was taken.
 * Each form is a fixed string, not localized text: Node's errno name, vite's
 * `--strictPort` refusal, and Playwright's refusal of a port something already
 * answers on. Anchored to the port, so a collision on a port the audit did not
 * pick (vite's HMR websocket, say) is the site's failure and is not retried.
 */
export function portInUse(output: string, port: number): boolean {
  const p = escape(String(port));
  return [
    new RegExp(`\\bEADDRINUSE\\b[^\\n]*:${p}(?!\\d)`),
    new RegExp(`\\bPort ${p} is already in use\\b`),
    new RegExp(`:${p}(?!\\d)\\S* is already used, make sure that nothing is running on the port`),
  ].some((re) => re.test(output));
}

/** `count` free ports, distinct from each other. */
export async function findFreePorts(count: number): Promise<number[]> {
  const ports: number[] = [];
  for (let picks = 0; ports.length < count && picks < count + 4; picks += 1) {
    const candidate = await findFreePort();
    if (!ports.includes(candidate)) ports.push(candidate);
  }
  if (ports.length < count) {
    throw new Error(`could not allocate ${count} distinct free ports (got ${ports.join(", ")})`);
  }
  return ports;
}

/**
 * Run an audit's server on `count` freshly picked ports, and again on fresh
 * ones while `collided` says one of them was taken, up to {@link PORT_ATTEMPTS}
 * runs. Any other outcome, failures included, returns at once.
 */
export async function withPortRetry<T>(
  count: number,
  run: (ports: number[]) => Promise<T>,
  collided: (result: T, ports: number[]) => boolean,
): Promise<T> {
  let ports = await findFreePorts(count);
  let result = await run(ports);
  for (let attempt = 1; attempt < PORT_ATTEMPTS && collided(result, ports); attempt += 1) {
    ports = await findFreePorts(count);
    result = await run(ports);
  }
  return result;
}

/** The combined output of a spawn, for {@link portInUse}. */
export function spawnOutput(raw: { stdout: string; stderr: string }): string {
  return `${raw.stdout}\n${raw.stderr}`;
}
