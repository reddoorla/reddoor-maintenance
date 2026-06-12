import type { WebsiteRow } from "./airtable/websites.js";

export type ResolvedCopy = {
  maintenanceIntro: string;
  maintenanceChecks: string[]; // 6; index 3 is the Google row's no-position default
  testingIntro: string;
  testingChecklist: string[]; // 6
  notesHeader: string;
  seoCta: string;
  contact: string[]; // closing invitation lines
  footerOrg: string;
  footerAddress: string[];
};

export const DEFAULT_COPY: ResolvedCopy = {
  maintenanceIntro:
    "Includes checking the hosting, DNS, Content Management System (CMS, if applicable), search indexing and security of the site for major flaws and updating as necessary.",
  maintenanceChecks: [
    "Reviewed Logs",
    "CMS Checked",
    "DNS Checked",
    "Google Indexed",
    "Reviewed Certificate",
    "Security Updates",
  ],
  testingIntro:
    "Testing includes checks similar to those at launch: testing on common browsers and operating systems, at different screen sizes, and checking every function, and updating all packages for performance rather than just those needed for security.",
  testingChecklist: [
    "Desktop Browsers",
    "Mobile Browsers",
    "Package Updates",
    "Bottlenecks",
    "Form Functionality",
    "Animation Functionality",
  ],
  notesHeader: "NOTES",
  seoCta: "Contact us if you are interested in more in-depth data or have questions about SEO.",
  contact: ["Just hit reply.", "We're here to help in any way we can."],
  footerOrg: "Reddoor Creative, LLC",
  footerAddress: ["29027 Dapper Dan", "Fair Oaks Ranch, TX 78015"],
};

/** Trim an override to null when blank (mirrors dashboardToken). */
function override(v: string | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * Resolve a site's effective copy: DEFAULT_COPY with the three per-site narrative
 * overrides applied. Only maintenanceIntro/contact/footer are per-site (M6a §2);
 * everything else is the shared default. PURE.
 */
export function resolveCopy(site: WebsiteRow): ResolvedCopy {
  const intro = override(site.copyIntro);
  const contact = override(site.copyContact);
  const footer = override(site.copyFooter);
  const footerLines = footer ? footer.split("\n") : null;
  return {
    ...DEFAULT_COPY,
    maintenanceIntro: intro ?? DEFAULT_COPY.maintenanceIntro,
    contact: contact ? contact.split("\n") : DEFAULT_COPY.contact,
    footerOrg: footerLines ? (footerLines[0] ?? DEFAULT_COPY.footerOrg) : DEFAULT_COPY.footerOrg,
    footerAddress: footerLines ? footerLines.slice(1) : DEFAULT_COPY.footerAddress,
  };
}
