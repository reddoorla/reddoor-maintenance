export type SearchApiConfig = {
  /** Google Cloud API key with the Custom Search API enabled. */
  apiKey: string;
  /** Programmable Search Engine ID (cx), configured to search the entire web. */
  engineId: string;
};

/**
 * Read Custom Search config from the environment (credentials.env is loaded into process.env
 * by the CLI entrypoint). Returns null unless BOTH vars are set — the signal that the
 * search-presence check is not configured, so it's skipped silently.
 */
export function readSearchConfig(): SearchApiConfig | null {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY?.trim();
  const engineId = process.env.GOOGLE_SEARCH_ENGINE_ID?.trim();
  if (!apiKey || !engineId) return null;
  return { apiKey, engineId };
}
