import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = ({ locals, url }) => ({
  email: locals.email,
  path: url.pathname,
});
