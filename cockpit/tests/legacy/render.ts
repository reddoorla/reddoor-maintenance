import { createRawSnippet, type Component } from "svelte";
import { render } from "svelte/server";
import Layout from "../../src/routes/+layout.svelte";
import HomePage from "../../src/routes/+page.svelte";
import FleetPage from "../../src/routes/fleet/+page.svelte";
import SitePage from "../../src/routes/s/[slug]/+page.svelte";
import SubmissionsPage from "../../src/routes/submissions/+page.svelte";
import AuditsPage from "../../src/routes/audits/+page.svelte";
import SubmissionRowInner from "../../src/lib/submission/SubmissionRowInner.svelte";
import { buildCockpitView, buildSitesView, type SitesView } from "../../src/lib/cockpit/view.js";
import { buildFleetTableModel, parseFleetTableQuery } from "../../../src/dashboard/fleet-table.js";
import { buildSiteView } from "../../src/lib/site/view.js";
import { buildSubmissionRowView } from "../../src/lib/submission/view.js";
import { auditsPageView } from "../../src/lib/audits/view.js";
import { buildSubmissionsPageData } from "../../src/routes/submissions/data.js";
import type { CockpitModel } from "../../../src/dashboard/fleet-cockpit.js";
import type { SiteAlarmContext } from "../../../src/dashboard/fleet-cockpit.js";
import type { FleetTableModel } from "../../../src/dashboard/fleet-table.js";
import type { SubmissionsPageModel } from "../../../src/dashboard/submissions-page.js";
import type { WebsiteRow } from "../../../src/fleet/site-row.js";
import type { ReportRow } from "../../../src/reports/report-fields.js";
import type { SubmissionRow } from "../../../src/reports/submission-row.js";
import type { ScreenOutTotals } from "../../../src/db/screenouts.js";
import type { ProspectAuditListItem } from "../../../src/db/prospect-audits.js";

/**
 * The old string renderers' signatures, answered by the SvelteKit pages (#582
 * cutover). The render tests written against the old renderers (moved here
 * from tests/dashboard/) keep their assertions and run against what the
 * cockpit now serves: the page inside the real layout, as a whole document
 * shaped like SvelteKit's `app.html`. Each page receives exactly the data its
 * `+page.server.ts` load returns.
 */

/** Svelte's hydration markers (`<!--[-->`, `<!---->`), which the old pages
 *  never had and a visitor never sees. Removed until none is left, so the old
 *  substring assertions read the markup itself. */
export function withoutComments(html: string): string {
  let out = html;
  for (let prev = ""; prev !== out;) {
    prev = out;
    out = out.replace(/<!--[\s\S]*?-->/g, "");
  }
  return out;
}

function documentOf<D>(
  page: Component<{ data: D }>,
  data: D,
  path: string,
  email: string | null,
): string {
  const inner = render(page, { props: { data } });
  const children = createRawSnippet(() => ({ render: () => inner.body }));
  const outer = render(Layout, { props: { data: { email, path }, children } });
  return withoutComments(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${outer.head}${inner.head}
  </head>
  <body data-sveltekit-reload>
    <div style="display: contents">${outer.body}</div>
  </body>
</html>`);
}

export function renderCockpitHtml(
  model: CockpitModel,
  operatorEmail: string | null = null,
): string {
  return documentOf(HomePage, { view: buildCockpitView(model, new Date()) }, "/", operatorEmail);
}

const NO_SITES_VIEW: SitesView = { filters: [], cards: {}, recently: [], archived: [] };

export function renderFleetTableHtml(
  m: FleetTableModel,
  operatorEmail: string | null = null,
  sites: SitesView = NO_SITES_VIEW,
): string {
  return documentOf(FleetPage, { model: m, sites }, "/fleet", operatorEmail);
}

/** Sites (`/fleet`) for a cockpit model, since the browse panel's cards and the
 *  Recently and Archived lanes moved there (#672 step 3): the table's rows are
 *  the model's card sites, in the default order, each with its card's health. */
export function renderSitesHtml(model: CockpitModel, operatorEmail: string | null = null): string {
  const table = buildFleetTableModel(
    model.cards.map((c) => c.site),
    parseFleetTableQuery(new URLSearchParams()),
  );
  return renderFleetTableHtml(table, operatorEmail, buildSitesView(model, new Date()));
}

export function renderSiteDashboardHtml(
  site: WebsiteRow,
  reports: ReportRow[],
  submissions: SubmissionRow[] = [],
  spam: ScreenOutTotals | null = null,
  now: Date = new Date(),
  alarm: SiteAlarmContext | null = null,
  operatorEmail: string | null = null,
): string {
  const view = buildSiteView(site, reports, submissions, spam, now, alarm);
  return documentOf(SitePage, { view }, `/s/${site.name}`, operatorEmail);
}

export function renderSubmissionsPageHtml(
  m: SubmissionsPageModel,
  operatorEmail: string | null = null,
): string {
  return documentOf(SubmissionsPage, buildSubmissionsPageData(m), "/submissions", operatorEmail);
}

/** The old renderer's input, kept so the moved tests' fixtures still type. */
export type ProspectAuditsPageModel = {
  audits: ProspectAuditListItem[];
  now: Date;
  operatorEmail?: string | null;
};

export function renderProspectAuditsPageHtml(input: {
  audits: ProspectAuditListItem[];
  now: Date;
  operatorEmail?: string | null;
}): string {
  return documentOf(
    AuditsPage,
    auditsPageView(input.audits, input.now),
    "/audits",
    input.operatorEmail ?? null,
  );
}

/** The browse panel's content, which `renderFleetBrowsePanel` rendered on `/`,
 *  now lives on Sites (#672 step 3): this renders Sites for the model. */
export function renderFleetBrowsePanel(model: CockpitModel): string {
  return renderSitesHtml(model);
}

/** One submission row, as `renderSubmissionRow` rendered it (with its `<li>`). */
export function renderSubmissionRow(s: SubmissionRow): string {
  const row = buildSubmissionRowView(s);
  return withoutComments(
    `<li class="subm-item">${render(SubmissionRowInner, { props: { row } }).body}</li>`,
  );
}
