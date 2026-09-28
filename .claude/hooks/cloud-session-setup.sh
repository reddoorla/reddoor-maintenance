#!/bin/bash
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0

notes=()

if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
  if ! git fetch -q --unshallow --tags origin >&2; then
    notes+=("git fetch --unshallow --tags FAILED; the clone is still shallow with no v* tags, so check-match-harness-snapshots.mjs and its test refuse to run.")
  fi
fi

want_node=$(tr -d '[:space:]' < .nvmrc 2>/dev/null)
if [ -n "$want_node" ]; then
  export NVM_DIR="${NVM_DIR:-/opt/nvm}"
  node_bin=""
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    set +u
    . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
    if nvm install "$want_node" >&2; then
      node_bin=$(dirname "$(nvm which "$want_node" 2>/dev/null)")
    fi
    set -u
  fi
  if [ -n "$node_bin" ] && [ -x "$node_bin/node" ]; then
    export PATH="$node_bin:$PATH"
    if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
      printf 'export PATH="%s:$PATH"\n' "$node_bin" >> "$CLAUDE_ENV_FILE"
    fi
  else
    notes+=("Node $want_node from .nvmrc could not be installed through nvm at $NVM_DIR; this session runs $(node -v 2>/dev/null || echo 'no node') while CI runs Node 24.")
  fi
fi

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
  elif ! PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD='' pnpm exec playwright install --with-deps "${engines[@]}" >&2; then
    notes+=("playwright install --with-deps ${engines[*]} FAILED although cdn.playwright.dev answered HTTP $cdn_status; browser audits will not run.")
  fi
fi

apt_install() {
  apt-get install -y -q "$@" >&2 || { apt-get update -q >&2 && apt-get install -y -q "$@" >&2; }
}

if ! command -v gh >/dev/null 2>&1; then
  gh_keyring=/usr/share/keyrings/githubcli-archive-keyring.gpg
  gh_list=/etc/apt/sources.list.d/github-cli.list
  if curl -fsSL -m 30 https://cli.github.com/packages/githubcli-archive-keyring.gpg -o "$gh_keyring" \
    && chmod go+r "$gh_keyring" \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=$gh_keyring] https://cli.github.com/packages stable main" > "$gh_list" \
    && apt-get update -q -o Dir::Etc::sourcelist="sources.list.d/github-cli.list" -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0 >&2 \
    && apt-get install -y -q gh >&2; then
    :
  else
    notes+=("gh could not be installed from cli.github.com; scripts that shell out to gh will fail.")
  fi
fi

proxy_ca="$HOME/.ccr/agent-proxy-ca.crt"
if [ -s "$proxy_ca" ]; then
  nssdb="$HOME/.pki/nssdb"
  command -v certutil >/dev/null 2>&1 || apt_install libnss3-tools
  split_dir=$(mktemp -d)
  imported=0
  failed=0
  if command -v certutil >/dev/null 2>&1 && mkdir -p "$nssdb" \
    && { [ -f "$nssdb/cert9.db" ] || certutil -N -d "sql:$nssdb" --empty-password >&2; }; then
    awk -v dir="$split_dir" '/BEGIN CERTIFICATE/ { n++ } n { print > (dir "/" n ".pem") }' "$proxy_ca"
    for pem in "$split_dir"/*.pem; do
      [ -s "$pem" ] || continue
      fp=$(openssl x509 -in "$pem" -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2 | tr -d ':' | cut -c1-16)
      if [ -n "$fp" ] && certutil -A -d "sql:$nssdb" -n "ccr-proxy-ca-$fp" -t "C,," -i "$pem" >&2; then
        imported=$((imported + 1))
      else
        failed=$((failed + 1))
      fi
    done
  else
    failed=1
  fi
  rm -r "$split_dir"
  if [ "$failed" -gt 0 ] || [ "$imported" -eq 0 ]; then
    notes+=("The egress proxy's CA ($proxy_ca) could not be added to Chromium's NSS store at $nssdb; every Chromium page load over HTTPS will fail with ERR_CERT_AUTHORITY_INVALID.")
  fi
fi

if [ "${#notes[@]}" -gt 0 ]; then
  printf '%s\n' "${notes[@]}" | node -e '
    const text = "cloud-session-setup:\n" + require("fs").readFileSync(0, "utf8").trim().split("\n").map((l) => "- " + l).join("\n");
    process.stdout.write(JSON.stringify({ systemMessage: text, hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }));
  '
fi
exit 0
