import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import type { MarketplaceListingDetail } from "../src/facebook/types.js";
import { TrackerStore } from "../src/tracker/store.js";
import { assess, moneyCents } from "../src/tracker/model.js";
import { scan } from "../src/tracker/scan.js";
import { report } from "../src/tracker/report.js";
import { createTrackerServer } from "../src/tracker/server.js";
import { parseListingDetailFromPage } from "../src/facebook/parser.js";

const detail = (patch: Partial<MarketplaceListingDetail> = {}): MarketplaceListingDetail => ({id:"111",title:"2008 Volkswagen Golf",description:"Runs and drives. 750 OBO",price:"CAD 750.00",postedDate:"2026-09-01T12:00:00.000Z",location:"Cambridge, ON",sellerName:"Example seller",url:"https://www.facebook.com/marketplace/item/111/",imageUrl:"",images:[],isPending:false,condition:"Used",seller:{name:"Example seller",profileUrl:""},...patch});
const crm = (patch: Record<string, unknown> = {}) => ({status:"Offer sent" as const,offer_cents:50000,counter_cents:null,follow_up:"2026-10-17",note:"Asked about a lower price",revision:0,request_id:randomUUID(),...patch});

test("sold flags and coordinates belong to the requested listing only", () => {
  const html='<script type="application/json">'+JSON.stringify({related:{id:"222",marketplace_listing_title:"Other",is_sold:true,location:{latitude:50,longitude:-90}},target:{id:"111",marketplace_listing_title:"Golf",is_sold:false,location:{latitude:43.35,longitude:-80.31}}})+'</script>';
  const result=parseListingDetailFromPage(html,"111");assert.equal(result.isSold,false);assert.equal(result.latitude,43.35);assert.equal(result.longitude,-80.31);
});

test("listing observations preserve CRM and append price evidence across restarts", t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"donor-store-test-")); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const filename=path.join(dir,"tracker.sqlite");let store=new TrackerStore(filename);
  store.observe(detail(),"2026-10-15T12:00:00.000Z");store.updateCrm("111",crm());
  store.observe(detail({price:"CAD 650",postedDate:""}),"2026-10-16T12:00:00.000Z");store.close();
  store=new TrackerStore(filename);t.after(()=>store.close());
  const car=store.get("111")!;
  assert.equal(car.crm_status,"Offer sent");assert.equal(car.offer_cents,50000);assert.equal(car.price_cents,65000);
  assert.equal(car.first_price_cents,75000);assert.equal(car.posted_at,"2026-09-01T12:00:00.000Z");
  assert.equal(store.history("111").observations.length,2);assert.equal(store.history("111").activity.length,1);
  assert.equal(store.drops("2026-10-16T00:00:00.000Z")[0].previous_price,75000);
});

test("inquiry retries are idempotent and stale tabs cannot overwrite notes", t => {
  const store=new TrackerStore(":memory:");t.after(()=>store.close());store.observe(detail());
  const input=crm();store.updateCrm("111",input);store.updateCrm("111",input);
  assert.equal(store.history("111").activity.length,1);
  assert.throws(()=>store.updateCrm("111",crm({note:"stale overwrite"})),/another tab/);
  store.updateCrm("111",crm({status:"Seller declined",revision:1,note:"They declined C$500; want C$650",counter_cents:65000}));
  assert.equal(store.get("111")?.crm_status,"Seller declined");assert.equal(store.history("111").activity.length,2);
  assert.throws(()=>store.updateCrm("111",crm({revision:2,follow_up:"2026-02-30"})),/follow-up/);
});

test("age boosts negotiation priority, while unknown age stays unknown", t => {
  const store=new TrackerStore(":memory:");t.after(()=>store.close());
  store.observe(detail(),"2026-10-16T12:00:00.000Z");
  const car=store.get("111")!, now=new Date("2026-10-16T13:00:00Z");
  const older=assess(car,now), fresh=assess({...car,posted_at:"2026-10-16T12:00:00Z"},now);
  assert.equal(older.age_days,45);assert.ok(older.score>fresh.score);
  const unknown=assess({...car,posted_at:null},now);assert.equal(unknown.age_days,null);assert.equal(unknown.tracked_days,0);
});

test("screening excludes parts placeholders and verified outside-radius results", t => {
  const store=new TrackerStore(":memory:");t.after(()=>store.close());store.observe(detail());const car=store.get("111")!;
  assert.equal(assess({...car,title:"Audi A4 front seats",price_cents:10000}).eligible,false);
  assert.equal(assess({...car,title:"Volkswagen 2.5 07k w/ Auto Transmission",price_cents:55000}).eligible,false);
  assert.equal(assess({...car,title:"2008 Volkswagen Golf (PARTS)",description:"Lmk what parts you need from it"}).eligible,false);
  assert.equal(assess({...car,title:"2008 Volkswagen Golf engine issue",description:"Selling whole car"}).eligible,true);
  assert.ok(assess({...car,title:"2008 Audi A4",description:"No keys, not sure kms or issues"}).checks.includes("No keys; engine operation unverified"));
  assert.equal(assess({...car,latitude:43.73,longitude:-79.76}).eligible,false);
  assert.equal(assess({...car,price_cents:130000}).eligible,false);
  assert.equal(moneyCents("USD 750"),null);assert.equal(moneyCents("CA$1,200"),120000);assert.equal(moneyCents("750–1000"),null);
});

test("baseline prices can anchor drops but placeholders and unknowns do not invent drops", t => {
  const store=new TrackerStore(":memory:");t.after(()=>store.close());
  store.observe(detail(),"2026-10-15T12:00:00.000Z","baseline");
  store.observe(detail({price:"CAD 650"}),"2026-10-16T12:00:00.000Z");
  store.observe(detail({price:"CAD 1"}),"2026-10-16T12:01:00.000Z");
  store.observe(detail({price:"N/A"}),"2026-10-16T12:02:00.000Z");
  assert.equal(store.drops("2026-10-16T00:00:00.000Z").length,1);
});

test("failed searches and unreadable details retain cars and do not mark them sold", async t => {
  const store=new TrackerStore(":memory:");t.after(()=>store.close());store.observe(detail());store.updateCrm("111",crm());
  const result=await scan(store,{async searchListings(){throw new Error("GraphQL unavailable");},async getListingDetail(){throw new Error("Could not verify listing");}});
  assert.equal(result.status,"failed");assert.equal(store.get("111")?.availability,"available");
  assert.equal(store.get("111")?.crm_status,"Offer sent");assert.equal(store.history("111").observations.length,1);
  assert.match(report(store).markdown,/Latest scan failed/);
});

test("scan deduplicates search IDs and refreshes cars missing from search", async t => {
  const store=new TrackerStore(":memory:");t.after(()=>store.close());store.observe(detail({id:"222"}));
  const ids:string[]=[];
  const result=await scan(store,{async searchListings(){return{listings:[detail()],hasNextPage:false,endCursor:null};},async getListingDetail(id){ids.push(id);return detail({id});}});
  assert.deepEqual(ids,["111","222"]);assert.equal(result.new_cars,1);assert.equal(result.refreshed,2);
});

test("scan lease prevents overlapping runs and recovers interrupted scans", t => {
  const store=new TrackerStore(":memory:");t.after(()=>store.close());
  const first=store.acquireScan(new Date("2026-10-16T12:00:00Z"));assert.ok(first);
  assert.equal(store.acquireScan(new Date("2026-10-16T12:01:00Z")),null);
  assert.ok(store.acquireScan(new Date("2026-10-16T13:00:00Z")));
  assert.equal((store.scans().find(row=>(row as {id:string}).id===first) as {status:string}).status,"failed");
});

test("evening report separates new discoveries, prior-window drops and older worthwhile leads", t => {
  const store=new TrackerStore(":memory:");t.after(()=>store.close());
  store.observe(detail(),"2026-10-14T12:00:00.000Z");store.observe(detail({price:"CAD 650"}),"2026-10-16T12:00:00.000Z");
  store.observe(detail({id:"222",title:"2011 Audi A4"}),"2026-10-16T12:01:00.000Z");
  const output=report(store,new Date("2026-10-16T22:15:00Z"));assert.equal(output.new_cars,1);assert.equal(output.price_drops,1);
  assert.match(output.markdown,/45d listed/);assert.match(output.markdown,/\$750.*\$650/);assert.match(output.markdown,/not profit estimates/);
});

test("local API protects inquiry writes from cross-site requests and persists valid saves", async t => {
  const store=new TrackerStore(":memory:");store.observe(detail());
  const server=createTrackerServer(store);server.listen(0,"127.0.0.1");await once(server,"listening");
  t.after(()=>{server.closeAllConnections();server.close();store.close();});
  const address=server.address();assert.ok(address && typeof address==='object');const origin=`http://127.0.0.1:${address.port}`;
  const state=await(await fetch(origin+"/api/state")).json() as {token:string};
  const input=crm({note:'<script>example untrusted note</script>'});
  const denied=await fetch(origin+"/api/cars/111",{method:"POST",headers:{"Content-Type":"application/json","Origin":"https://example.com","X-Tracker-Token":state.token},body:JSON.stringify(input)});assert.equal(denied.status,403);
  const saved=await fetch(origin+"/api/cars/111",{method:"POST",headers:{"Content-Type":"application/json","Origin":origin,"X-Tracker-Token":state.token},body:JSON.stringify(input)});assert.equal(saved.status,200);
  assert.equal(store.get("111")?.offer_cents,50000);
  const home=await fetch(origin+"/");assert.match(home.headers.get("content-security-policy")??"",/frame-ancestors 'none'/);
});
