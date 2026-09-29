export const CREDENTIAL_ENV =
  /^(TURSO_|RESEND_|PRISMIC_|NETLIFY_|DISCORD_|GA_|PERPLEXITY_|TURNSTILE_|FORMS_INGEST_|PROSPECT_|DASHBOARD_|OPERATOR_EMAIL$|REPORT_BASE_URL$|GH_TOKEN$|GITHUB_TOKEN$|CLAUDE_OAUTH$)/;

export function stripCredentials(
  env: Record<string, string | undefined>,
  emptyConfigHome: string,
): void {
  for (const name of Object.keys(env)) {
    if (CREDENTIAL_ENV.test(name)) delete env[name];
  }
  env.XDG_CONFIG_HOME = emptyConfigHome;
}
