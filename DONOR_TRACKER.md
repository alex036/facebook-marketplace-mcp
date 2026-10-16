# Local donor watch

Open **http://127.0.0.1:4318** on this Mac. The UI runs as the user LaunchAgent `ca.partloop.donor-tracker` and starts at login. It listens only on loopback.

The tracker uses the existing Facebook client and Chrome profile, a local SQLite database, and a small browser UI. No new runtime dependency is added. This is a standalone Smith Euro Parts acquisition tracker. There is no Partloop connection. It does not contact sellers or commit to purchases. The existing database folder name is retained so your history stays in place.

## Search and reporting

- Every scan searches `Volkswagen`, `Audi`, `Jetta` and `Golf`, plus two rotating queries: `Volkswagen as is` / `Audi as is`, `VW not running` / `Audi not running`, `VW parts car` / `Audi parts car`, `GTI` / `GLI`, `Passat` / `Rabbit`, then `Beetle` / `Audi TT`. A full rotation takes six scans. Requests use newest-listed sorting with all listing ages allowed.
- A separate motivated-seller search alternates `Volkswagen need gone` and `Audi need gone`, up to C$1,600. Only actual motivation wording in the requested ad qualifies an above-budget vehicle for **Negotiation watch**; the normal shortlist ceiling stays C$1,200. Seller acceptance of a lower offer is never assumed.
- Centre: Cambridge, Ontario (43.3581, -80.3114), requested radius 50 km, maximum normal asking C$1,200; initial model-year focus 1998–2015. Unknown model years require checking.
- Scan schedule: 8 a.m. and 6 p.m. America/Toronto. One evening report at 6:15 p.m. returns to the Codex chat where the tracker was requested. Successful scan runs have notifications muted; the separate evening report supplies the digest.
- Local scans and reports require this Mac awake and Codex running. The UI startup agent alone does not schedule scans. Chrome must retain a valid Facebook login.
- Each scan checks up to two provider pages per query, deduplicates listing IDs and refreshes up to 75 ads. Search stubs are hydrated only inside this shared refresh limit, avoiding repeated page fetches across queries. Active inquiries refresh first, followed by up to 25 known candidates ordered by oldest refresh, then new discoveries and other tracked ads. Existing inquiries/candidates are revisited even when missing from search. Coverage caps, provider errors and stale scans appear in the report.
- Exact distances use coordinates from the requested listing, when available, and are straight-line distances from Cambridge. Outside-radius ads and individual-component/shell ads are retained in **All tracked ads**, but excluded from the shortlist. Whole-car offers with removed assemblies remain assessable, with missing-parts warnings. Part-out wording alone is not proof that a whole donor is unavailable. Unknown coordinates remain explicitly unverified. Search terms and their first/last observation dates are recorded separately from verified detail observations.
- Evening reports cover the preceding 24 hours: newly discovered qualifying cars, verified asking-price drops, the top screening leads and due inquiry follow-ups. Reports are retained locally by Toronto calendar date.

## Listing age and assessment

**Age of listing** is computed from Facebook's timestamp for the requested listing. **First found here** is the independent first observation in this tracker. Missing listed dates remain unknown; discovery time never pretends to be the listed date. A seller can relist a vehicle under another ID, so this is the observed ad's age, not proof of how long the underlying car has been for sale.

The scorecard has 100 available points: model fit/demand 20, acquisition cost 20, completeness 15, rust/physical condition 15, mechanical condition/testability 10, distance/pickup 5, listing age/negotiation 5, listing information 5, and ownership documentation 5.

Missing evidence is `unknown`, never an assumed good condition or a zero-point failure. Displayed opportunity is a provisional range from supported points to supported points plus all unknown categories' available points. A fully assessed car has one score. Coverage is the percentage of category weights assessed. Confidence is Low below 60% coverage, after a detail failure, or when details are over 36 hours old; otherwise Medium, becoming High only at 85% coverage with at least 50 points of categories reviewed by you. Confidence measures evidence coverage and review, not truth or sale probability.

Age awards 1 point under 2 days, 2 at 2–6 days, 3 at 7–20 days, 4 at 21–44 days and 5 at 45+ days. A separate Newly listed badge flags ads under 48 hours. Model points express target fit, not measured sales demand. Listing-information points describe how much information the ad supplies, not whether a seller is trustworthy. Mechanical failures affect the testability category and component warnings without additional blanket deductions.

Enter a pickup/towing estimate (explicit zero for confirmed free collection) to calculate asking plus pickup cost. The automatic cost screen awards 20 points up to C$700, 15 up to C$900, 10 up to C$1,200, and 5 above that. It is not a parts-recovery or profit forecast and excludes dismantling/disposal costs. Without a pickup estimate, cost remains unknown. Your offer and counteroffer are kept separate from asking price.

Use **Review or adjust scorecard** to override individual categories with a score or explicitly mark them unknown. Every override needs supporting evidence. Use listing evidence to remove an override. Reviews are append-only, reject stale revisions, survive scans/restarts, and have their own visible history. They do not change inquiry status, offers or notes. Revisit manual assessments when listing facts change.

With adequate coverage, 80+ supported points and High confidence prompts Contact now; 65+ prompts Investigate. Incomplete cases with a possible 65+ remain Investigate — incomplete, or Needs evidence below 60% coverage. Lower supported scores with no such upside become Watch / lower offer (50+) or Low priority. Above-budget leads stay Negotiation watch. Ownership problems block purchase readiness and exclude a car from the report's top leads; due diligence is still required for every purchase. Ratings are not profit estimates or market valuations.

## Inquiry log

Statuses: New, Interested, Contacted, Offer sent, Seller declined, Follow up, Deal agreed, Bought, Pass.

Record your offer, a seller counteroffer, a follow-up date and append-only notes. **My inquiries** includes cars you have marked beyond New (except Pass). Seller-declined cars remain available for reference. Reports include recent inquiry activity, your latest note/offer/counteroffer, and due follow-ups even when a car has moved outside the shortlist. A verified price drop after a recorded seller decline is highlighted for reconsideration, without implying acceptance or sending a message. A declined inquiry without a new drop or a due follow-up is omitted from the top-five action list. A scan never overwrites these fields. Saves reject stale CRM revisions and retry safely without duplicating activity. Unsaved drafts survive switching cars within the open page; navigating away warns before discarding them.

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
