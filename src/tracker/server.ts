import http from "node:http";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { FacebookClient } from "../facebook/client.js";
import { SEARCH, STATUSES } from "./model.js";
import { TrackerStore } from "./store.js";
import { scan, safeError, type ScannerClient } from "./scan.js";
import { report } from "./report.js";

const crmInput = z.object({ status: z.enum(STATUSES), offer_cents: z.number().int().min(0).max(100000000).nullable(), counter_cents: z.number().int().min(0).max(100000000).nullable(), follow_up: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), note: z.string().max(10000), revision: z.number().int().nonnegative(), request_id: z.string().regex(/^[\w-]{10,100}$/) }).strict();

const reviewInput = z.object({ revision: z.number().int().nonnegative(), request_id: z.string().regex(/^[\w-]{10,100}$/), pickup_cents: z.number().int().min(0).max(100000000).nullable(), ratings: z.record(z.object({ score: z.number().int().nullable(), evidence: z.string().trim().min(1).max(500) }).strict()) }).strict();

export function createTrackerServer(store: TrackerStore, makeClient: () => ScannerClient = () => new FacebookClient({ chromeProfile: process.env.CHROME_PROFILE ?? "Default", browser: process.env.BROWSER ?? "chrome" })) {
  const token = randomBytes(32).toString("hex");
  const server = http.createServer(async (req, res) => {
    const address = server.address();
    const port = address && typeof address === "object" ? address.port : 4318;
    const host = req.headers.host ?? "";
    const json = (status: number, value: unknown) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); res.end(JSON.stringify(value)); };
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) return json(403, { error: "Local access only" });
    const url = new URL(req.url ?? "/", `http://${host}`);
    try {
      if (req.method === "GET" && url.pathname === "/api/state") return json(200, { token, search: SEARCH, statuses: STATUSES, cars: store.view(), drops: store.drops(new Date(Date.now()-86400000).toISOString()), scans: store.scans(), generated_at: new Date().toISOString() });
      const history = url.pathname.match(/^\/api\/cars\/(\d+)$/);
      if (req.method === "GET" && history) { if (!store.get(history[1])) return json(404,{error:"Car not found"}); return json(200,store.history(history[1])); }
      if (req.method === "GET" && url.pathname === "/api/report") return json(200, report(store));
      if (req.method === "POST") {
        if (req.headers.origin !== `http://${host}` || req.headers["x-tracker-token"] !== token || !req.headers["content-type"]?.startsWith("application/json")) return json(403,{error:"Refresh the tracker before saving"});
        let body = "";
        for await (const chunk of req) { body += chunk.toString(); if (Buffer.byteLength(body)>16384) return json(413,{error:"Request too large"}); }
        if (url.pathname === "/api/scan") {
          const result = scan(store, makeClient());
          void result.catch(error => console.error(safeError(error)));
          return json(202,{started:true});
        }
        const scorecard = url.pathname.match(/^\/api\/cars\/(\d+)\/scorecard$/);
        if (scorecard) {
          const input=reviewInput.parse(JSON.parse(body));
          try { return json(200,{review:store.saveReview(scorecard[1],input)}); }
          catch(error) { const message=safeError(error); return json(/another tab/.test(message)?409:400,{error:message}); }
        }
        if (history) {
          const input = crmInput.parse(JSON.parse(body));
          try { return json(200,{car:store.updateCrm(history[1],input)}); }
          catch(error) { const message=safeError(error); return json(/another tab/.test(message)?409:400,{error:message}); }
        }
      }
      const files: Record<string, [string,string]> = { "/":["index.html","text/html"], "/app.js":["app.js","text/javascript"], "/style.css":["style.css","text/css"] };
      const file = files[url.pathname];
      if (req.method === "GET" && file) {
        res.writeHead(200,{"Content-Type":`${file[1]}; charset=utf-8`,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'","Referrer-Policy":"no-referrer"});
        return res.end(fs.readFileSync(new URL(`./public/${file[0]}`,import.meta.url)));
      }
      json(404,{error:"Not found"});
    } catch(error) { json(400,{error:error instanceof z.ZodError ? "Check the inquiry or scorecard fields" : error instanceof SyntaxError ? "Invalid request" : safeError(error)}); }
  });
  return server;
}
