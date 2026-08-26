import type { Context, Config } from "@netlify/functions";
import { listSites, listAllReports } from "../../src/db/fleet-state.js";
import { openDb, readDbConfig } from "../../src/db/client.js";
import {
  listNewSubmissions,
  countAutoSpamSince,
  countNotifyBouncedBySite,
} from "../../src/db/submissions.js";
import { NOTIFY_BOUNCE_WINDOW_DAYS } from "../../src/alerts/digest-collectors.js";
import { listFleetEvents } from "../../src/db/fleet-events.js";
import { listScreenOutsSince, screenOutsSince } from "../../src/db/screenouts.js";
import { readDigestState } from "../../src/db/digest-state.js";
import { requireOperator, denialResponse, renderCockpitHtml } from "../../src/dashboard/index.js";
import { buildCockpitModel } from "../../src/dashboard/fleet-cockpit.js";
import { resolveDashboardBaseUrl, handlerError } from "../../src/dashboard/handler-helpers.js";

// Owns the root path. The per-site dashboard function continues to own
// /s/:slug; the resend-webhook function continues to own its own path.
// Phase 2 decision was Netlify site-level password — implemented here as
// HTTP Basic Auth against DASHBOARD_PASSWORD env var rather than via
// Netlify dashboard settings, so the gate ships with the code.
export const config: Config = {
  path: ["/"],
  rateLimit: {
    windowSize: 60,
    windowLimit: 60,
    aggregateBy: ["ip"],
  },
};

function plainText(
  body: string,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...extraHeaders },
  });
}

function html(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  // Authenticate BEFORE the Airtable/Turso env guards so an unauthenticated probe
  // can't tell which backend env is unset (a differentiated 500 leaks config
  // state). Only the password check — unavoidable, since auth needs it — precedes.
  const auth = requireOperator(req, { wants: "redirect" });
  if (!auth.ok) return denialResponse(auth.denial);

  // #609: this page no longer touches Airtable at all. The last call was the
  // digest NEW-badge read, which was an AIRTABLE CALL ON A REQUEST PATH — a
  // Phase 2 leftover, since digest state was never in that phase's scope. With
  // it on Turso the AIRTABLE_PAT/AIRTABLE_BASE_ID gate that used to guard this
  // handler is gone too: the page cannot be degraded by an Airtable outage.
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[fleet-homepage] TURSO_DATABASE_URL missing");
    return plainText("Turso env missing", 500);
  }

  try {
    // Phase 2 (#539): Turso IS the cockpit's core data now (sites + reports +
    // submissions), so open it non-defensively — a failure 502s rather than
    // rendering a misleading "0 sites" page. As of #609 it is the ONLY store
    // this handler reads.
    const db = await openDb(readDbConfig());
    // Fetch the three inputs once. reports + digest are each defensive so one
    // hiccup can't blank the page; sites is the cockpit's core data, so a
    // failure there can't degrade to an empty (misleading "0 sites") page —
    // instead the whole try falls to handlerError for a clean retry-able 502.
    const websites = await listSites(db);
    let reports: Awaited<ReturnType<typeof listAllReports>> = [];
    try {
      reports = await listAllReports(db);
    } catch {
      // approve strip + delivery signals simply absent — triage still renders
    }
    let prior: Awaited<ReturnType<typeof readDigestState>> = {};
    try {
      prior = await readDigestState(db);
    } catch {
      // everything badges as not-NEW (the {} initial); never crashes the page
    }
    let newSubmissions: Awaited<ReturnType<typeof listNewSubmissions>> = [];
    {
      try {
        newSubmissions = await listNewSubmissions(db);
      } catch {
        // submissions strip simply absent — triage still renders
      }
    }
    let spamTotals: { honeypot: number; tooFast: number; markedSpam: number } | null = null;
    {
      try {
        const since = screenOutsSince(new Date(), 30);
        const map = await listScreenOutsSince(db, since);
        spamTotals = { honeypot: 0, tooFast: 0, markedSpam: 0 };
        for (const t of map.values()) {
          spamTotals.honeypot += t.honeypot;
          spamTotals.tooFast += t.tooFast;
          spamTotals.markedSpam += t.markedSpam;
        }
      } catch {
        // roll-up simply absent — never blank the cockpit
      }
    }
    let recentEvents: Awaited<ReturnType<typeof listFleetEvents>> = [];
    {
      try {
        const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        recentEvents = await listFleetEvents(db, { sinceIso, limit: 20 });
      } catch {
        // Recently lane simply absent — the cockpit still renders.
      }
    }
    let autoFilteredCount = 0;
    {
      try {
        const since = screenOutsSince(new Date(), 7);
        autoFilteredCount = await countAutoSpamSince(db, since);
      } catch {
        // affordance simply absent — never blank the cockpit
      }
    }
    let notifyBounces: ReadonlyMap<string, number> = new Map();
    {
      try {
        const since = screenOutsSince(new Date(), NOTIFY_BOUNCE_WINDOW_DAYS);
        notifyBounces = await countNotifyBouncedBySite(db, since);
      } catch {
        // bounce alarm simply absent — never blank the cockpit
      }
    }
    const baseUrl = resolveDashboardBaseUrl(process.env.DASHBOARD_BASE_URL);
    const model = buildCockpitModel(
      websites,
      reports,
      prior,
      baseUrl,
      new Date(),
      newSubmissions,
      spamTotals,
      recentEvents,
      autoFilteredCount,
      notifyBounces,
    );
    return html(renderCockpitHtml(model, auth.email), 200);
  } catch (err) {
    return handlerError("fleet-homepage", err);
  }
};
