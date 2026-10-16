import fs from "node:fs";
import path from "node:path";
import type { MarketplaceListing, MarketplaceListingDetail, SearchParams, SearchResult } from "../facebook/types.js";
import { assess, isVehicleTitle, SEARCH } from "./model.js";
import { TrackerStore } from "./store.js";

export interface ScannerClient {
  searchListings(params: SearchParams, hydrate?: boolean): Promise<SearchResult>;
  getListingDetail(id: string): Promise<MarketplaceListingDetail>;
}

const ROTATING_QUERIES = ["Volkswagen as is", "Audi as is", "VW not running", "Audi not running", "VW parts car", "Audi parts car", "GTI", "GLI", "Passat", "Rabbit", "Beetle", "Audi TT"];
export function searchPlan(completedRuns: number) {
  const start=(completedRuns*2)%ROTATING_QUERIES.length;
  return [...["Volkswagen","Audi","Jetta","Golf",ROTATING_QUERIES[start],ROTATING_QUERIES[start+1]].map(query=>({query,maxPrice:SEARCH.maxPrice})),
    {query:completedRuns%2 ? "Audi need gone" : "Volkswagen need gone",maxPrice:1600}];
}

export async function scan(store: TrackerStore, client: ScannerClient, log: (message: string) => void = () => {}) {
  const run = store.acquireScan();
  if (!run) return { busy: true, status: "running", refreshed: 0, new_cars: 0, errors: [], warnings: ["A scan is already running"] };
  const summary = { busy: false, status: "complete", refreshed: 0, new_cars: 0, errors: [] as string[], warnings: [] as string[], queries: [] as {query:string;maxPrice:number}[] };
  const discovered = new Map<string, MarketplaceListing>();
  const progress = () => {
    if (!store.db.prepare("UPDATE scan_lock SET expires_at=? WHERE owner=?").run(new Date(Date.now()+45*60000).toISOString(),run).changes) throw new Error("Scan lease was lost; stopped before another provider request");
    store.db.prepare("UPDATE scan_runs SET summary=? WHERE id=? AND status='running'").run(JSON.stringify(summary),run);
  };
  try {
    if (store.db.name !== ":memory:") {
      const backupDir = path.join(path.dirname(store.db.name), "backups");
      fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      const today = new Date().toISOString().slice(0,10);
      const backup = path.join(backupDir, `${today}.sqlite`);
      if (!fs.existsSync(backup)) await store.db.backup(backup);
      const old = fs.readdirSync(backupDir).filter(name => /^\d{4}-\d{2}-\d{2}\.sqlite$/.test(name)).sort().slice(0,-7);
      for (const name of old) fs.unlinkSync(path.join(backupDir, name));
    }
    const completedRuns=(store.db.prepare("SELECT COUNT(*) n FROM scan_runs WHERE status!='running'").get() as {n:number}).n;
    summary.queries=searchPlan(completedRuns);
    for (const {query,maxPrice} of summary.queries) {
      let cursor: string | undefined;
      const cursors = new Set<string>();
      for (let page = 0; page < 2; page++) {
        progress();
        try {
          log(`Searching ${query}, page ${page+1}`);
          const result = await client.searchListings({ query, ...SEARCH, maxPrice, sortBy: "date_listed", dateListed: "all", limit: 100, cursor }, false);
          for (const listing of result.listings) if (/^\d+$/.test(listing.id) && (listing.needsHydration || isVehicleTitle(listing.title))) {
            discovered.set(listing.id,listing); store.searchHit(listing.id,query);
          }
          if (!result.hasNextPage || !result.endCursor) break;
          if (cursors.has(result.endCursor)) { summary.warnings.push(`${query}: Facebook repeated its pagination cursor`); break; }
          cursors.add(result.endCursor); cursor = result.endCursor;
          if (page === 1) summary.warnings.push(`${query}: checked two provider pages; further results may exist`);
        } catch (error) {
          summary.errors.push(`${query}: ${safeError(error)}`); break;
        }
      }
    }
    // Reserve refresh capacity for inquiries and rotate known ads by oldest successful refresh.
    const retained = store.cars().filter(car => !["Bought", "Pass"].includes(car.crm_status) && car.availability !== "sold")
      .sort((a,b) => (a.last_detail_at ?? "").localeCompare(b.last_detail_at ?? ""));
    const inquiries=retained.filter(car=>car.crm_status!=="New");
    const knownCandidates=retained.filter(car=>{const a=assess(car);return a.eligible || a.negotiation_watch;});
    const newIds=[...discovered.keys()].filter(id=>!store.get(id));
    const ids = [...new Set([...inquiries.map(car=>car.id), ...knownCandidates.slice(0,25).map(car=>car.id), ...newIds, ...retained.map(car=>car.id), ...discovered.keys()])];
    if (ids.length > 75) summary.warnings.push(`${ids.length-75} detail refreshes deferred by the 75-car scan limit`);
    for (const id of ids.slice(0,75)) {
      progress();
      try {
        log(`Refreshing ${id}`);
        const existing = store.get(id);
        const detail = await client.getListingDetail(id);
        store.observe(detail, new Date().toISOString(), "detail", discovered.has(id));
        summary.refreshed++; if (!existing) summary.new_cars++;
      } catch (error) {
        const message = safeError(error);
        store.detailFailed(id, message);
        summary.errors.push(`Listing ${id}: ${message}`);
      }
      progress();
    }
    summary.status = summary.errors.length ? (summary.refreshed ? "partial" : "failed") : "complete";
  } catch (error) { summary.status = "failed"; summary.errors.push(safeError(error)); }
  finally { store.finishScan(run, summary.status, summary); }
  return summary;
}

export function safeError(error: unknown): string {
  // Keep request bodies, cookies and arbitrary provider markup out of stored diagnostics.
  const message = error instanceof Error ? error.message : "Unknown error";
  if (/token|cookie|header|<!doctype|<html|fb_dtsg/i.test(message)) return "Facebook session/request failed; reconnect Chrome and retry";
  return message.slice(0,300);
}
