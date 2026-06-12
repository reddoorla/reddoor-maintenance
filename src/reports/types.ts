export type ReportType = "Maintenance" | "Testing" | "Launch";

export type LighthouseScores = {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
};

export type HeaderImage = {
  /** Stable filename, used as the CID inside the email and as the attachment name in Resend. */
  filename: string;
  /** Bytes of the image, fetched once from Airtable before render+send. */
  bytes: Uint8Array;
  /** MIME, e.g. "image/jpeg". */
  contentType: string;
};

/** Everything the template needs to render one report email. */
export type ReportData = {
  siteName: string;
  siteUrl: string;
  reportType: ReportType;
  completedOn: Date;
  lighthouse: LighthouseScores;
  /** GA "Users" for the period / previous period. `undefined` = GA unavailable (not
   *  configured, no property ID, or fetch failed) — rendered as "—", distinct from a real 0.
   *  `| undefined` is explicit so callers can pass `undefined` under exactOptionalPropertyTypes. */
  gaUsersCurrent?: number | undefined;
  gaUsersPrevious?: number | undefined;
  /** Site's rounded average Google position for its query, when on page 1 (from Search Console).
   *  `undefined` = not on page 1, not checked, or unconfigured — rendered as today's plain check. */
  searchPosition?: number | undefined;
  /** Only used when reportType === "Maintenance"; the date shown next to the blurred-testing image. */
  lastTestedDate: Date | null;
  /** Optional free-text rendered as a section above the footer. */
  commentary: string | null;
  /** Resolved per-site copy (M6a). Omitted → the template falls back to DEFAULT_COPY. */
  copy?: import("./copy.js").ResolvedCopy;
  /** Used in the header `mj-image src`; the email attaches the bytes with this CID. */
  headerImageCid: string;
  /**
   * Header display dimensions (CSS px) and placeholder color. When all three are present,
   * the template renders the header with an explicit width/height (reserves the box, so the
   * email doesn't reflow when the image loads) and a `container-background-color` placeholder.
   * Absent (e.g. local preview), the header falls back to a bare `<mj-image>`.
   * Produced by `prepareHeaderImage` in the send path.
   */
  headerWidth?: number;
  headerHeight?: number;
  headerBgColor?: string;
};
