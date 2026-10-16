# Personal fork maintenance

Upstream: https://github.com/jdcodes1/facebook-marketplace-mcp
Personal fork: https://github.com/alex036/facebook-marketplace-mcp
Reviewed on 2026-10-16. Local checkout: `/Users/alex/projects/facebook-marketplace-mcp-personal`.

## Open pull requests reviewed

| PR | Treatment in this fork |
| --- | --- |
| [#1](https://github.com/jdcodes1/facebook-marketplace-mcp/pull/1) — JSON listing fields | Superseded by #4's listing-ID-scoped parser; no page-wide first-match regex. |
| [#4](https://github.com/jdcodes1/facebook-marketplace-mcp/pull/4) — authentication, contracts, parsing and search | Ported scoped Relay parsing, linked public/internal IDs, fragment merging, parser regression tests, search query shapes, sort/delivery/date options, structured search/detail results, cursor exposure, and sanitized response validation. Kept existing seven tool names and Chrome-cookie authentication. Dedicated login/session files, replacement MCP contracts, raw HTML capture and diagnostic log storage are intentionally not adopted. |
| [#5](https://github.com/jdcodes1/facebook-marketplace-mcp/pull/5) — search recovery, listing fields, profiles | Ported skeleton listing hydration, limit-before-hydration, independent page request budget and display-name profile lookup. Used #4's scoped parser in place of #5's page-wide regex parser. |
| [#6](https://github.com/jdcodes1/facebook-marketplace-mcp/pull/6) — Windows and multiple browsers | Cherry-picked original commit `baa7897`. Combined modern cookie paths/profile resolution with #5/#7 and tightened browser validation and temporary cookie-file cleanup. Windows/Edge/Brave are not hardware-verified here. |
| [#7](https://github.com/jdcodes1/facebook-marketplace-mcp/pull/7) — query refresh and capture tooling | Current search query ID, modern `Network/Cookies` preference, dedicated capture profile and capture script. Added its missing Playwright development dependency. Capture script is not live-tested here. |

Open issue [#2](https://github.com/jdcodes1/facebook-marketplace-mcp/issues/2) requests npm publication; no npm publication is needed for this local installation.

The previous local installation at `/Users/alex/projects/facebook-marketplace-mcp` was left intact, including its uncommitted dependency/query-ID fixes. The new lockfile retains compatible security updates (`npm audit` reports zero vulnerabilities at verification).

## Data correctness

Listing fields come only from embedded JSON objects matching the requested public listing ID or an explicitly linked internal listing ID. Related items cannot supply the target price, description, photos, seller or pending flag. Missing prices remain unknown. A page without a verifiable listing is an error, not a successful empty record.

Search results expose structured data alongside the existing text. `cursor` advances to the next Facebook provider page. If Facebook returns more items than `limit`, `omittedCount` and a text warning disclose items omitted from the current page; increase `limit` (maximum 100) to retrieve them before advancing. A successful empty search differs from malformed/error-only data.

Date filters reproduce community-captured UTC calendar-day windows; `last_24_hours` includes today and yesterday rather than guaranteeing a rolling 24-hour cutoff. Search filters are requests to Facebook, not proof that every returned suggestion obeys those filters.

## Local use

```sh
npm ci
npm run build
npm test
```

Codex continues to use server name `facebook-marketplace`, Node 22 and `CHROME_PROFILE=Default`. The configured entry point is this checkout's `dist/index.js`. Tool discovery/handshake and five original vehicle detail reads were tested through a fresh stdio MCP client; all five prices matched the previously browser-verified prices, with nonempty titles/descriptions and multiple photos. A Cambridge Volkswagen search returned exactly the requested five results and disclosed nine additional current-page results omitted by the limit. Live verification output stays under ignored `.local/`.

Saved monitors still use `~/.fb-marketplace/monitors.json`. They do not schedule themselves. No donor database, UI or scheduled job is included in this MCP repair.

## Updating

```sh
git fetch upstream
git log --oneline master..upstream/master
git switch -c update-upstream
```

Review and integrate upstream changes on that branch, resolve overlap with the table above, then run build/tests and read-only live checks before merging into `master` and rebuilding. The GitHub Check workflow runs build, tests and runtime dependency audit on pushes and pull requests. No automatic upstream merging or npm publishing is configured.
