import type { Handle } from "@sveltejs/kit";
import { requireOperator, denialResponse } from "../../src/dashboard/auth/require.js";

/**
 * Every cockpit page is operator-only, through the same gate the Netlify page
 * functions call: a signed session cookie, or the shared-password fallback where
 * that is still allowed. Navigations are redirected to sign-in, never sent JSON.
 * Sign-in itself (`/auth/*`) and the `/api/*` endpoints stay with the Netlify
 * functions.
 */
export const handle: Handle = async ({ event, resolve }) => {
  const auth = requireOperator(event.request, { wants: "redirect" });
  if (!auth.ok) return denialResponse(auth.denial);
  event.locals.email = auth.email;
  return resolve(event);
};
