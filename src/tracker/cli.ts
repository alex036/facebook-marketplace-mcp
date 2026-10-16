#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { FacebookClient } from "../facebook/client.js";
import { TrackerStore, DATA_DIR } from "./store.js";
import { scan, safeError } from "./scan.js";
import { report } from "./report.js";
import { createTrackerServer } from "./server.js";

const command = process.argv[2] ?? "serve";
const store = new TrackerStore();
try {
  if (command === "serve") {
    const port = Number(process.env.DONOR_TRACKER_PORT ?? 4318);
    if (!Number.isInteger(port) || port<1024 || port>65535) throw new Error("Invalid tracker port");
    const server = createTrackerServer(store);
    server.listen(port,"127.0.0.1",()=>console.log(`Donor tracker: http://127.0.0.1:${port}`));
    server.on("error",error=>{ console.error(safeError(error)); store.close(); process.exitCode=1; });
    for (const signal of ["SIGTERM","SIGINT"] as const) process.on(signal,()=>server.close(()=>{store.close();process.exit(0);}));
  } else if (command === "scan") {
    const result = await scan(store,new FacebookClient({chromeProfile:process.env.CHROME_PROFILE??"Default",browser:process.env.BROWSER??"chrome"}),message=>console.error(message));
    console.log(JSON.stringify(result)); if (result.status === "failed") process.exitCode=1;
  } else if (command === "report") {
    const result = report(store);
    const dir=path.join(DATA_DIR,"reports"); fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const date=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Toronto",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    fs.writeFileSync(path.join(dir,`${date}.md`),result.markdown,{mode:0o600});
    console.log(result.markdown);
  } else if (command === "import-baseline") {
    const filename=process.argv[3]; if(!filename) throw new Error("Provide a baseline JSON filename");
    const data=JSON.parse(fs.readFileSync(filename,"utf8")); let count=0;
    if(!Array.isArray(data.candidates) || !Number.isFinite(Date.parse(data.observed_at_utc))) throw new Error("Invalid baseline");
    for(const car of data.candidates) {
      if(store.get(car.listing_id)) continue;
      store.observe({id:car.listing_id,title:car.title,description:(car.seller_claims??[]).join("\n"),price:`CAD ${car.asking_price_cad}`,location:car.location,sellerName:"",imageUrl:"",images:[],postedDate:"",url:car.url,isPending:false,condition:"",seller:{name:"",profileUrl:""}},data.observed_at_utc,"baseline",false); count++;
    }
    console.log(JSON.stringify({imported:count}));
  } else throw new Error("Use serve, scan, report, or import-baseline");
} catch(error) { console.error(safeError(error)); process.exitCode=1; }
finally { if(command!=="serve") store.close(); }
