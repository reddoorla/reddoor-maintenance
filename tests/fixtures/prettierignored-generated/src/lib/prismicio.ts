// Minimal Prismic client for the pristine-starter fixture. Real sites export
// createClient (+ sometimes isPlaceholderRepo); the health-endpoint recipe only
// checks that this module EXISTS to pick the Prismic-aware /health variant, so a
// self-contained stub is enough — the recipe tests never build the site.
export const repositoryName = "pristine-fixture";
export const isPlaceholderRepo = false;

export function createClient() {
  return { getRepository: async () => ({}) };
}
