import { dev } from "$app/environment";
import { HOME_COPY } from "$lib/copy/home";
import { createClient } from "$lib/prismicio";

// Under `vite dev` alone, a cookie serves the code's wording as a fixture
// document; no visitor reaches that branch.
export const load = async ({ fetch, cookies }) => ({
  page:
    dev && cookies.get("fixture")
      ? { data: { ...HOME_COPY, cta_label: "Fixture button" } }
      : await createClient({ fetch }).getSingle("home"),
});
