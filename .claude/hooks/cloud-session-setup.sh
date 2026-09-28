#!/bin/bash
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0

notes=()

if ! pnpm install --frozen-lockfile >&2; then
  notes+=("pnpm install --frozen-lockfile FAILED; tests, lint and audits will not run until it succeeds.")
fi

cred_dir="${XDG_CONFIG_HOME:-$HOME/.config}/reddoor-maint"
ga_key="$cred_dir/ga-service-account.json"
if [ -n "${GA_SA_KEY_B64:-}" ]; then
  mkdir -p "$cred_dir"
  if (umask 077 && printf '%s' "$GA_SA_KEY_B64" | base64 -d > "$ga_key" 2>/dev/null) \
    && node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$ga_key" 2>/dev/null; then
    :
  else
    rm -f "$ga_key"
    notes+=("GA_SA_KEY_B64 is set but is not base64 of a JSON service-account key; GA and Search Console checks will not run.")
  fi
fi

engines=(chromium chromium-headless-shell firefox webkit)
missing=()
while read -r dir; do
  [ -f "$dir/INSTALLATION_COMPLETE" ] || missing+=("$dir")
done < <(pnpm exec playwright install --dry-run "${engines[@]}" 2>/dev/null | sed -n 's/^ *Install location: *//p')

if [ "${#missing[@]}" -gt 0 ]; then
  cdn_status=$(curl -s -o /dev/null -m 5 -w '%{http_code}' https://cdn.playwright.dev/ 2>/dev/null)
  if [ "$cdn_status" = "000" ]; then
    notes+=("Playwright browsers matching the pinned @playwright/test are not installed, and cdn.playwright.dev is blocked by this environment's network policy. A bare chromium.launch() (browser, form-e2e and a11y audits) will fail. Allow cdn.playwright.dev and playwright.download.prss.microsoft.com in the environment's Network access, then start a new session.")
  elif ! PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD= pnpm exec playwright install --with-deps "${engines[@]}" >&2; then
    notes+=("playwright install --with-deps ${engines[*]} FAILED although cdn.playwright.dev answered HTTP $cdn_status; browser audits will not run.")
  fi
fi

if [ "${#notes[@]}" -gt 0 ]; then
  printf '%s\n' "${notes[@]}" | node -e '
    const text = "cloud-session-setup:\n" + require("fs").readFileSync(0, "utf8").trim().split("\n").map((l) => "- " + l).join("\n");
    process.stdout.write(JSON.stringify({ systemMessage: text, hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }));
  '
fi
exit 0
