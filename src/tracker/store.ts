import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type { MarketplaceListingDetail } from "../facebook/types.js";
import { assess, detailFields, STATUSES, type Car, type CrmStatus } from "./model.js";

export const DATA_DIR = process.env.DONOR_TRACKER_DIR ?? path.join(os.homedir(), "Library/Application Support/Partloop Donor Tracker");
export class TrackerStore {
  db: Database.Database;
  constructor(filename = path.join(DATA_DIR, "tracker.sqlite")) {
    if (filename !== ":memory:") fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL"); this.db.pragma("foreign_keys = ON"); this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cars (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', seller TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL, image_url TEXT NOT NULL DEFAULT '', price_cents INTEGER, price_text TEXT NOT NULL DEFAULT '', first_price_cents INTEGER,
        posted_at TEXT, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, last_search_at TEXT, last_detail_at TEXT,
        availability TEXT NOT NULL DEFAULT 'available', latitude REAL, longitude REAL, detail_error TEXT,
        crm_status TEXT NOT NULL DEFAULT 'New', offer_cents INTEGER, counter_cents INTEGER, follow_up TEXT, crm_revision INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS observations (id INTEGER PRIMARY KEY, car_id TEXT NOT NULL REFERENCES cars(id), observed_at TEXT NOT NULL, price_cents INTEGER, price_text TEXT NOT NULL, availability TEXT NOT NULL, posted_at TEXT, source TEXT NOT NULL, snapshot TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS observations_by_car ON observations(car_id, observed_at, id);
      CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY, car_id TEXT NOT NULL REFERENCES cars(id), at TEXT NOT NULL, request_id TEXT UNIQUE NOT NULL, note TEXT NOT NULL, changes TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS scan_runs (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '{}');
      CREATE TABLE IF NOT EXISTS scan_lock (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, expires_at TEXT NOT NULL);
    `);
  }
  close() { this.db.close(); }
  get(id: string): Car | undefined { return this.db.prepare("SELECT * FROM cars WHERE id=?").get(id) as Car | undefined; }
  cars(): Car[] { return this.db.prepare("SELECT * FROM cars ORDER BY first_seen_at DESC").all() as Car[]; }
  view(now = new Date()) { return this.cars().map(car => ({ ...car, assessment: assess(car, now) })); }
  observe(detail: MarketplaceListingDetail, at = new Date().toISOString(), source = "detail", seenInSearch = true) {
    if (!/^\d+$/.test(detail.id) || !detail.title) throw new Error("Cannot store an unidentified listing");
    const fields = detailFields(detail);
    if (fields.posted_at && Date.parse(fields.posted_at) > Date.parse(at)) fields.posted_at = null;
    this.db.transaction(() => {
      const existing = this.get(detail.id);
      if (!existing) this.db.prepare("INSERT INTO cars(id,title,url,first_seen_at,last_seen_at,first_price_cents) VALUES(?,?,?,?,?,?)")
        .run(detail.id, detail.title, `https://www.facebook.com/marketplace/item/${detail.id}/`, at, at, fields.price_cents);
      const assignments = Object.keys(fields).filter(key=>!["posted_at","latitude","longitude"].includes(key)).map(key => `${key}=@${key}`).join(",");
      this.db.prepare(`UPDATE cars SET ${assignments}, posted_at=COALESCE(@posted_at,posted_at), latitude=COALESCE(@latitude,latitude), longitude=COALESCE(@longitude,longitude), last_seen_at=@at, last_detail_at=@at, last_search_at=CASE WHEN @search=1 THEN @at ELSE last_search_at END, detail_error=NULL WHERE id=@id`)
        .run({ ...fields, id: detail.id, at, search: Number(seenInSearch) });
      this.db.prepare("INSERT INTO observations(car_id,observed_at,price_cents,price_text,availability,posted_at,source,snapshot) VALUES(?,?,?,?,?,?,?,?)")
        .run(detail.id, at, fields.price_cents, fields.price_text, fields.availability, fields.posted_at, source, JSON.stringify(fields));
    })();
  }
  detailFailed(id: string, message: string) { this.db.prepare("UPDATE cars SET detail_error=? WHERE id=?").run(message.slice(0,300), id); }
  history(id: string) {
    return { observations: this.db.prepare("SELECT id,observed_at,price_cents,price_text,availability,posted_at,source FROM observations WHERE car_id=? ORDER BY id DESC LIMIT 200").all(id),
      activity: this.db.prepare("SELECT * FROM activity WHERE car_id=? ORDER BY id DESC LIMIT 200").all(id).map(row => { const r = row as { changes: string }; return { ...r, changes: JSON.parse(r.changes) }; }) };
  }
  updateCrm(id: string, input: { status: CrmStatus; offer_cents: number | null; counter_cents: number | null; follow_up: string | null; note: string; revision: number; request_id: string }) {
    if (!STATUSES.includes(input.status) || !Number.isSafeInteger(input.revision) || input.revision < 0 || !/^[\w-]{10,100}$/.test(input.request_id) || input.note.length > 10000) throw new Error("Invalid inquiry update");
    for (const price of [input.offer_cents, input.counter_cents]) if (price != null && (!Number.isSafeInteger(price) || price < 0 || price > 100000000)) throw new Error("Invalid offer amount");
    if (input.follow_up) {
      const date=new Date(`${input.follow_up}T12:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.follow_up) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==input.follow_up) throw new Error("Invalid follow-up date");
    }
    return this.db.transaction(() => {
      const duplicate = this.db.prepare("SELECT car_id FROM activity WHERE request_id=?").get(input.request_id) as {car_id:string} | undefined;
      if (duplicate) { if (duplicate.car_id !== id) throw new Error("Update token already used for another car"); return this.get(id); }
      const car = this.get(id); if (!car) throw new Error("Car not found");
      if (car.crm_revision !== input.revision) throw new Error("This inquiry changed in another tab. Refresh before saving; your notes are still in the form.");
      const changes = { status: input.status, offer_cents: input.offer_cents, counter_cents: input.counter_cents, follow_up: input.follow_up };
      this.db.prepare("UPDATE cars SET crm_status=@status,offer_cents=@offer_cents,counter_cents=@counter_cents,follow_up=@follow_up,crm_revision=crm_revision+1 WHERE id=@id").run({ ...changes, id });
      this.db.prepare("INSERT INTO activity(car_id,at,request_id,note,changes) VALUES(?,?,?,?,?)").run(id, new Date().toISOString(), input.request_id, input.note.trim(), JSON.stringify(changes));
      return this.get(id);
    })();
  }
  acquireScan(now = new Date()): string | null {
    return this.db.transaction(() => {
      this.db.prepare("DELETE FROM scan_lock WHERE expires_at<=?").run(now.toISOString());
      this.db.prepare("UPDATE scan_runs SET status='failed',finished_at=?,summary=? WHERE status='running' AND id NOT IN(SELECT owner FROM scan_lock)").run(now.toISOString(),JSON.stringify({errors:["Previous scan was interrupted; previous listing observations were retained"]}));
      const owner = randomUUID();
      if (!this.db.prepare("INSERT OR IGNORE INTO scan_lock VALUES(1,?,?)").run(owner, new Date(now.getTime()+45*60000).toISOString()).changes) return null;
      this.db.prepare("INSERT INTO scan_runs(id,started_at,status) VALUES(?,?,'running')").run(owner, now.toISOString());
      return owner;
    })();
  }
  finishScan(id: string, status: string, summary: unknown) {
    this.db.transaction(() => {
      this.db.prepare("UPDATE scan_runs SET finished_at=?,status=?,summary=? WHERE id=?").run(new Date().toISOString(), status, JSON.stringify(summary), id);
      this.db.prepare("DELETE FROM scan_lock WHERE owner=?").run(id);
    })();
  }
  scans() { return this.db.prepare("SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 20").all().map(row => { const r = row as {summary:string}; return { ...r, summary: JSON.parse(r.summary) }; }); }
  drops(since: string) {
    // A true drop compares consecutive verified observations, including the one before the reporting window.
    return this.db.prepare(`WITH prices AS (
      SELECT car_id,observed_at,price_cents,source,LAG(price_cents) OVER(PARTITION BY car_id ORDER BY observed_at,id) previous_price
      FROM observations WHERE source IN ('detail','baseline') AND price_cents IS NOT NULL
    ) SELECT * FROM prices WHERE observed_at>=? AND price_cents>=20000 AND previous_price>price_cents ORDER BY observed_at DESC`).all(since) as {car_id:string;observed_at:string;price_cents:number;previous_price:number}[];
  }
}
