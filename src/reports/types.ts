export type ReportType = "Maintenance" | "Testing";

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
  gaUsersCurrent: number;
  gaUsersPrevious: number;
  /** Only used when reportType === "Maintenance"; the date shown next to the blurred-testing image. */
  lastTestedDate: Date | null;
  /** Optional free-text rendered as a section above the footer. */
  commentary: string | null;
  /** Used in the header `mj-image src`; the email attaches the bytes with this CID. */
  headerImageCid: string;
};
