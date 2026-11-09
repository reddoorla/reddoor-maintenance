// THROWAWAY probe (never merged): why did `domain` warn for msot in run 42711182637?
// Runs the production certValidTo logic verbatim, but keeps the reason, per host and per IP.
import { promises as dns } from "node:dns";
import tls from "node:tls";

const RUNS = Number(process.env.RUNS ?? 10);

/** Production's certValidTo, with the outcome recorded instead of collapsed to null. */
function probe(connectHost, servername, rejectUnauthorized = true) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const done = (r) => resolve({ ms: Date.now() - t0, remote: socket.remoteAddress ?? null, ...r });
    const socket = tls.connect(
      { host: connectHost, port: 443, servername, timeout: 10_000, rejectUnauthorized },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        done({
          outcome: socket.authorized ? "ok" : "unauthorized",
          authErr: socket.authorizationError ?? null,
          validTo: cert?.valid_to ?? null,
          validFrom: cert?.valid_from ?? null,
          serial: cert?.serialNumber ?? null,
          subject: cert?.subject?.CN ?? null,
          issuer: cert?.issuer?.CN ?? null,
          san: cert?.subjectaltname ?? null,
        });
      },
    );
    socket.on("error", (e) => done({ outcome: "error", code: e.code ?? null, message: e.message }));
    socket.on("timeout", () => {
      socket.destroy();
      done({ outcome: "timeout" });
    });
  });
}

async function dnsInfo(host) {
  const r = {};
  for (const [k, f] of [
    ["lookupAll", () => dns.lookup(host, { all: true })],
    ["lookupOne", () => dns.lookup(host)],
    ["A", () => dns.resolve4(host)],
    ["AAAA", () => dns.resolve6(host)],
  ]) {
    try {
      r[k] = await f();
    } catch (e) {
      r[k] = `ERR ${e.code}`;
    }
  }
  return r;
}

const hosts = (process.env.HOSTS ?? "medicalsolutionsoftx.com,roalson.com,expired.badssl.com,does-not-exist.invalid").split(",");
for (const host of hosts) {
  console.log(`\n===== ${host} =====`);
  console.log("dns", JSON.stringify(await dnsInfo(host)));
  for (let i = 0; i < RUNS; i++) console.log(`by-host #${i}`, JSON.stringify(await probe(host, host)));
  let ips = [];
  try {
    ips = (await dns.lookup(host, { all: true })).map((a) => a.address);
  } catch {}
  for (const ip of ips) {
    for (let i = 0; i < Math.min(RUNS, 5); i++)
      console.log(`ip ${ip} verify #${i}`, JSON.stringify(await probe(ip, host)));
    console.log(`ip ${ip} diag(noverify)`, JSON.stringify(await probe(ip, host, false)));
  }
}
// Timeout control: an unroutable address must come back "timeout", not an error.
console.log("\n===== timeout control 10.255.255.1 =====");
console.log("blackhole", JSON.stringify(await probe("10.255.255.1", "roalson.com")));
