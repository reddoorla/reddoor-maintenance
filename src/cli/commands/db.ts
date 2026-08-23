export type DbCommandOptions = {
  /** Override the libSQL url (tests use ":memory:"); otherwise read from env. */
  url?: string;
  cwd?: string;
  verbose?: boolean;
};

/** `db <action>` — migrate | replay-deadletters. The db layer is imported
 *  dynamically so a non-db CLI invocation (and `--help`) never loads
 *  @libsql/client. Config is resolved inside each branch so an unknown action
 *  returns without needing any Turso env. */
export async function runDbCommand(
  action: string,
  opts: DbCommandOptions,
): Promise<{ output: string; code: number }> {
  if (action === "migrate") {
    const { readDbConfig } = await import("../../db/client.js");
    const cfg = opts.url ? { url: opts.url } : readDbConfig();
    const { runMigrations } = await import("../../db/migrate.js");
    const { createClient } = await import("@libsql/client");
    const client = createClient(cfg.url === ":memory:" ? { url: ":memory:" } : cfg);
    const ran = await runMigrations(client);
    return {
      output: ran.length ? `Applied migrations: ${ran.join(", ")}` : "Already up to date.",
      code: 0,
    };
  }

  // Re-run every lead that dead-lettered during a site-lookup outage (#539
  // Phase 0) through the normal ingest pipeline. Exit 1 while any row is STILL
  // failing — the store hasn't recovered and the operator should not read the
  // run as "all leads landed". Zero rows is a clean 0: nothing owed.
  if (action === "replay-deadletters") {
    const { readDbConfig, openDb } = await import("../../db/client.js");
    const db = await openDb(opts.url ? { url: opts.url } : readDbConfig());
    const { openBase, readAirtableConfig } = await import("../../reports/airtable/client.js");
    const { getWebsiteBySlug } = await import("../../reports/airtable/websites.js");
    const base = openBase(readAirtableConfig());
    const {
      createSubmission,
      stampNotified,
      stampFanout,
      findRecentDuplicateSubmissions,
      listRecentSubmissionsForEmail,
      markSubmissionsSpamRetro,
    } = await import("../../db/submissions.js");
    const { makeNotify } = await import("../../forms/notify.js");
    const { classifySpam } = await import("../../forms/spam-classifier.js");
    const { forwardNewsletterToWebhook } = await import("../../forms/webhook.js");
    const { addMailchimpMember, mailchimpTagsFor } = await import("../../forms/mailchimp.js");
    const { defaultResendClient } = await import("../../reports/send/resend.js");
    const { replayDeadLetters } = await import("../../forms/replay.js");

    // Same degradation as the ingest handler: an unconfigured Resend key means
    // replayed leads land un-emailed (notify=failed) rather than blocking replay.
    let send = null;
    try {
      send = defaultResendClient().send;
    } catch (err) {
      console.error(`[db] Resend unconfigured; replaying without email: ${String(err)}`);
    }

    // Mirrors the production handler's deps minus `deadLetter` (replayDeadLetters
    // forbids and strips it — a throwing lookup must retry, not duplicate) and
    // minus `defer` (a CLI has no post-response phase; the inline tail is fine).
    const result = await replayDeadLetters(db, {
      getWebsiteBySlug: (s) => getWebsiteBySlug(base, s),
      createSubmission: (input) => createSubmission(db, input),
      notify: makeNotify(send),
      stampNotified: (id, status, messageId) => stampNotified(db, id, status, messageId),
      now: () => new Date(),
      classifySpam: (n, outcome) =>
        classifySpam({
          name: n.name,
          email: n.email,
          ...(n.message !== undefined ? { message: n.message } : {}),
          formType: n.formType,
          extraFields: n.extraFields,
          turnstile: outcome,
        }),
      findRecentDuplicates: (message, since) =>
        findRecentDuplicateSubmissions(db, message, since.toISOString()),
      listRecentSubmissionsForEmail: (email, since) =>
        listRecentSubmissionsForEmail(db, email, since.toISOString()),
      retroBucket: (ids, reason) => markSubmissionsSpamRetro(db, ids, reason),
      forwardNewsletter: (url, submission, site) =>
        forwardNewsletterToWebhook(url, submission, site),
      addToMailchimp: (site, submission) =>
        addMailchimpMember({
          apiKey: site.mailchimpApiKey ?? "",
          audienceId: site.mailchimpAudienceId ?? "",
          email: submission.email,
          name: submission.name,
          tags: mailchimpTagsFor(submission.formType),
        }),
      stampFanout: (id, fanoutStatus) => stampFanout(db, id, fanoutStatus),
    });

    const lines = [
      ...result.replayed.map(
        (r) => `replayed ${r.id} → ${r.outcome}${r.submissionId ? ` (${r.submissionId})` : ""}`,
      ),
      ...result.stillFailing.map((r) => `still failing ${r.id}: ${r.error}`),
      `DEADLETTER_REPLAY replayed=${result.replayed.length} still_failing=${result.stillFailing.length}`,
    ];
    return { output: lines.join("\n"), code: result.stillFailing.length > 0 ? 1 : 0 };
  }

  return {
    output: `unknown db action '${action}'. Use: migrate, replay-deadletters.`,
    code: 1,
  };
}
