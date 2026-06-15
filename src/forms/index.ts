/**
 * Public `@reddoorla/maintenance/forms` subpath — the site-facing API for
 * forwarding contact-form submissions to the dashboard ingest endpoint. Exports
 * ONLY browser/server-safe code; the dashboard-only modules (ingest/notify/token,
 * the Airtable submissions module) are intentionally not re-exported here.
 */
export {
  submitToIngest,
  screenSubmission,
  MIN_FILL_MS,
  type SubmissionPayload,
  type IngestClientResult,
  type SubmitToIngestOptions,
  type ScreenInput,
  type ScreenResult,
} from "./client.js";
export { SUBMISSION_FORM_TYPES, type FormType } from "./types.js";
export {
  createIngestAction,
  type CreateIngestActionOptions,
  type IngestActionConfig,
  type IngestActionData,
} from "./action.js";
