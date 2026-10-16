# Local donor watch

Open **http://127.0.0.1:4318** on this Mac. The UI runs as the user LaunchAgent `ca.partloop.donor-tracker` and starts at login. It listens only on loopback.

The tracker uses the existing Facebook client and Chrome profile, a local SQLite database, and a small browser UI. No new runtime dependency is added. Marketplace ads are potential acquisitions; bought cars can later be entered in Partloop's canonical donor workflow. This tracker does not create production donors, contact sellers or commit to purchases.

## Search and reporting

- Queries: `Volkswagen as is` and `Audi as is`.
- Centre: Cambridge, Ontario (43.3581, -80.3114), requested radius 50 km, maximum asking C$1,200.
- Scan schedule: 8 a.m. and 6 p.m. America/Toronto. One evening report at 6:15 p.m. returns to the Codex chat where the tracker was requested. Successful scan runs have notifications muted; the separate evening report supplies the digest.
- Local scans and reports require this Mac awake and Codex running. The UI startup agent alone does not schedule scans. Chrome must retain a valid Facebook login.
- Each scan checks up to two provider pages per query, deduplicates listing IDs and refreshes up to 75 ads. Existing active inquiries/candidates are revisited even when missing from search. Coverage caps, provider errors and stale scans appear in the report.
- Exact distances use coordinates from the requested listing, when available, and are straight-line distances from Cambridge. Outside-radius ads and likely component/part-out ads are retained in **All tracked ads**, but excluded from the shortlist. Unknown coordinates remain explicitly unverified.
- Evening reports cover the preceding 24 hours: newly discovered qualifying cars, verified asking-price drops, the top screening leads and due inquiry follow-ups. Reports are retained locally by Toronto calendar date.

## Listing age and assessment

**Age of listing** is computed from Facebook's timestamp for the requested listing. **First found here** is the independent first observation in this tracker. Missing listed dates remain unknown; discovery time never pretends to be the listed date. A seller can relist a vehicle under another ID, so this is the observed ad's age, not proof of how long the underlying car has been for sale.

Older ads get an offer-leverage boost at 14 and 30 days. Asking price, commuter-model fit, seller-reported running condition and mechanical faults also affect screening priority. The reasons and unanswered checks are visible. Ratings are not profit estimates or suggested market valuations. Confirm ownership, completeness, faults and towing costs before buying.

## Inquiry log

Statuses: New, Interested, Contacted, Offer sent, Seller declined, Follow up, Deal agreed, Bought, Pass.

Record your offer, a seller counteroffer, a follow-up date and append-only notes. **My inquiries** includes cars you have marked beyond New (except Pass). Seller-declined cars remain available for reference. A scan never overwrites these fields. Saves reject stale CRM revisions and retry safely without duplicating activity. Unsaved drafts survive switching cars within the open page; navigating away warns before discarding them.

Listing disappearance or an unreadable page is a refresh error, never proof of sale. A Facebook sold flag is recorded only when present on the requested listing. Asking-price history is distinct from transaction price; this version does not estimate or record final sale proceeds.

## Storage and backups

Database: `~/Library/Application Support/Partloop Donor Tracker/tracker.sqlite`.

Price observations and inquiry activities are retained rather than overwritten. SQLite uses WAL and a scan lease to avoid overlapping jobs. One database backup is taken before each day's first scan; the last seven dated backups are retained under `backups/`. Reports are stored under `reports/`. All data stays outside Git. Backups are local, not protection against loss of the Mac.

`DONOR_TRACKER_DIR` can override the directory for isolated tests or a manual installation. Use the default for normal scans/UI/reporting so they share one database.

## Commands

Run from `/Users/alex/projects/facebook-marketplace-mcp-personal` with Node 22:

```sh
npm ci
npm run build
npm test
npm run tracker:install-ui
npm run tracker:scan
npm run tracker:report
```

`npm run tracker` runs the UI in the foreground. `npm run tracker:import -- <baseline.json>` imports the earlier browser-verified baseline only for IDs not already present. Scan failures retain prior facts and inquiry notes, and return a nonzero exit code when nothing could be refreshed. Partial results are explicitly reported.

The local UI prevents cross-origin saves and rejects unexpected Host headers. Marketplace text and notes render as text; notes are never interpolated as executable markup. No seller messages are sent.

To stop automatic UI startup: `launchctl bootout gui/$(id -u)/ca.partloop.donor-tracker`. Pausing the separate Codex schedules stops scans/reports; stopping the UI alone does not.
