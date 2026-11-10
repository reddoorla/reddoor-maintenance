# 2026-11-10 — The domain check retries a timeout or reset once

Landed in this PR (`fix(audits)`). Follows `2026-11-10-0015-domain-audit-failure-reason.md` (reddoorla/reddoor-maintenance#2007), and builds the operator's answer to the workspace decision `decisions/2026-11-10-0016-domain-broken-after-one-run.md` (pick (c), 11-09 about 4:24pm PT).

**Why.** On 11-09 one domain check on MSOT failed. The site was healthy: browser, Lighthouse and `/health` passed in the same run, and 42 of 42 probes passed afterwards. That single failure raised a critical Broken, because `collectDomainAlerts` raises Broken off one fresh run with no cert days. The run timing points to a 10 s TLS stall, and MSOT's `/health` also stalled for 10 s on 11-07. The operator had three choices:

- keep it;
- require two failed runs in a row, which needs a migration and makes every real alert a night late;
- retry once inside the audit, only on transient codes.

He chose the retry.

**What.** If `certValidTo` fails with a `DomainTimeoutError` or with `ECONNRESET`, `ETIMEDOUT`, `EPIPE` or `ECONNABORTED`, it is called once more, straight away. Nothing else is retried:

- a DNS failure, even `EAI_AGAIN`, because the decision said never on DNS;
- `ECONNREFUSED`;
- any certificate verification code.

A dead domain or a bad cert still alerts the same night. If the retry passes, the audit passes, and the first failure is kept: `resolved, cert 75d remaining (passed on retry after tls timeout after 10000ms)` and `details.retriedAfter`. Two failures name both, as `tls timeout after 10000ms, then tls ECONNRESET`. The alert rule is untouched. The worst case per site is now 20 s instead of 10 s, and only when the site's edge is stalling.

**Tests.** Seven run through `domainAudit` with scripted deps:

- timeout then ok;
- reset then ok;
- two timeouts, with exactly two calls;
- a cert error, not retried;
- a refused connection, not retried;
- `EAI_AGAIN` DNS, not retried;
- a first-try pass that records no retry.

Two more run on real sockets: a silent peer twice, and a server that resets the first connection and then serves a trusted cert. Five assertions from #2007 changed, because a constant `ECONNRESET` or timeout now reports both attempts. The PR body lists them.

**Mutations, named before the code.**

| Mutation                       | Red |
| ------------------------------ | --- |
| (1) Retry every error          | 7   |
| (2) Never retry                | 8   |
| (3) Forget the retry on a pass | 3   |
| (4) Retry DNS                  | 1   |
| (5) A third attempt            | 1   |

**Instrument note.** My first pass at mutations 1, 2 and 4 printed nothing. They had broken the type check, and the suite's global setup runs `pnpm build`, so no test ran. A mutation must still compile before its silence means anything. I rewrote them at the call site so they compile, and they then went red as listed.
