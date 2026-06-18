import type { WebsiteRow } from "./airtable/websites.js";

export type ResolvedCopy = {
  maintenanceIntro: string;
  maintenanceChecks: string[]; // 6; index 3 is the Google row's no-position default
  testingIntro: string;
  testingChecklist: string[]; // 7
  notesHeader: string;
  seoCta: string;
  contact: string[]; // closing invitation lines
  footerOrg: string;
  footerAddress: string[];
  launchHeading: string;
  launchBody: string;
  launchSetupItems: string[];
  announceHeading: string;
  announceBody: string;
  announceCadenceHeading: string;
  announceTestingLabel: string;
  announceMaintenanceLabel: string;
  announcePreviewLabel: string;
  announceScoreNote: string;
  announceImprovementResend: string;
  announceImprovementSvelte5: string;
  announceCadence: string;
  announceOpenDoor: string;
};

export const DEFAULT_COPY: ResolvedCopy = {
  maintenanceIntro:
    "Includes checking the hosting, DNS, Content Management System (CMS, if applicable), search indexing and security of the site for major flaws and updating as necessary.",
  maintenanceChecks: [
    "Deploy & Function Health",
    "CMS Checked",
    "Domain, DNS & SSL",
    "Google Indexed",
    "Security Updates",
    "Uptime Checked",
  ],
  testingIntro:
    "Testing includes checks similar to those at launch: testing on common browsers and operating systems, at different screen sizes, and checking every function, and updating all packages for performance rather than just those needed for security.",
  testingChecklist: [
    "Desktop Browsers",
    "Mobile Browsers",
    "Page Titles & Meta",
    "Links & Navigation",
    "Form Functionality",
    "Interactions & Animations",
    "Tested After Updates",
  ],
  notesHeader: "NOTES",
  seoCta: "Contact us if you are interested in more in-depth data or have questions about SEO.",
  contact: ["Just hit reply.", "We're here to help in any way we can."],
  footerOrg: "Reddoor Creative, LLC",
  footerAddress: ["29027 Dapper Dan", "Fair Oaks Ranch, TX 78015"],
  launchHeading: "LAUNCHED",
  launchBody:
    "Your site is live. We've set it up on the Reddoor stack with hosting, security, and automatic maintenance so it stays fast and healthy. Here's what's in place:",
  launchSetupItems: [
    "Hosting, DNS, and SSL configured",
    "Continuous integration + automatic dependency updates",
    "Analytics and uptime monitoring",
  ],
  announceHeading: "YOUR ONGOING SITE CARE",
  announceBody:
    "We've completed a full test of your site and set it up for ongoing care to keep it fast, secure, and healthy. Here's what you can expect from us going forward:",
  announceCadenceHeading: "WHAT TO EXPECT",
  announceTestingLabel: "Full site testing",
  announceMaintenanceLabel: "Routine maintenance",
  announcePreviewLabel: "From your latest full site test:",
  announceScoreNote:
    "These are independent Google Lighthouse scores, each out of 100 — higher is better.",
  announceImprovementResend:
    "Your contact forms now deliver straight to your inbox through reliable infrastructure, so no inquiry slips through the cracks.",
  announceImprovementSvelte5:
    "We've modernized your site to the latest framework — it's faster, more secure, and built to last.",
  announceCadence:
    "After each one we'll send you a short report like this — there's nothing you need to do.",
  announceOpenDoor:
    "And if you'd ever like to expand the scope, add features, or freshen anything up, just reply — we'd love to help.",
};

/** Trim an override to null when blank (mirrors the trim-to-null handling). */
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
/** Split an operator override into lines: tolerate CRLF, drop blank lines (a stray
 *  blank in the Airtable cell shouldn't render an empty address row). */
function splitLines(s: string): string[] {
  return s.split(/\r?\n/).filter((l) => l.trim().length > 0);
}

export function resolveCopy(site: WebsiteRow): ResolvedCopy {
  const intro = override(site.copyIntro);
  const contact = override(site.copyContact);
  const footer = override(site.copyFooter);
  const footerLines = footer ? splitLines(footer) : null;
  return {
    ...DEFAULT_COPY,
    maintenanceIntro: intro ?? DEFAULT_COPY.maintenanceIntro,
    contact: contact ? splitLines(contact) : DEFAULT_COPY.contact,
    footerOrg: footerLines?.[0] ?? DEFAULT_COPY.footerOrg,
    footerAddress: footerLines ? footerLines.slice(1) : DEFAULT_COPY.footerAddress,
  };
}
