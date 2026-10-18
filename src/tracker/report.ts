import { type Car } from "./model.js";
import { TrackerStore } from "./store.js";

type Activity = { at: string; note: string; changes: { status: string; offer_cents: number | null; counter_cents: number | null; follow_up: string | null } };

export function report(store: TrackerStore, now = new Date()) {
  const since = new Date(now.getTime()-24*60*60*1000).toISOString();
  const cars = store.view(now);
  const active = cars.filter(car => !["Pass", "Bought"].includes(car.crm_status) && car.availability !== "sold");
  const candidates = active.filter(car => car.assessment.eligible);
  const negotiation = active.filter(car => car.assessment.negotiation_watch);
  const fresh = candidates.filter(car => car.first_seen_at >= since);
  const allDrops=store.drops(since);
  const drops = allDrops.filter(drop => [...candidates,...negotiation].some(car => car.id === drop.car_id));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const histories=new Map(cars.map(car=>[car.id,store.history(car.id).activity as unknown as Activity[]]));
  const declined = (id: string) => store.db.prepare("SELECT at,changes FROM activity WHERE car_id=? AND json_extract(changes,'$.status')='Seller declined' ORDER BY id DESC LIMIT 1").get(id) as {at:string;changes:string} | undefined;
  const reconsider = (car: Car) => {
    const last=declined(car.id);
    const latestActivity=histories.get(car.id)?.[0];
    return last && allDrops.some(drop=>drop.car_id===car.id && drop.observed_at>last.at && drop.price_cents===car.price_cents && (!latestActivity || drop.observed_at>latestActivity.at));
  };
  const context = (car: Car) => {
    const history=histories.get(car.id) ?? [], latest=history[0], lastDecline=declined(car.id);
    const parts = [`${car.crm_status}; your offer ${dollars(car.offer_cents)}; seller counter ${dollars(car.counter_cents)}`];
    if (lastDecline) {
      const changes=JSON.parse(lastDecline.changes) as Activity["changes"];
      parts.push(`Seller declined recorded ${lastDecline.at.slice(0,10)} (offer then ${dollars(changes.offer_cents)})`);
      if (reconsider(car)) parts.push("Asking price dropped after that decline; consider a manual follow-up, acceptance is unknown");
    }
    if (car.follow_up) parts.push(`Follow-up ${car.follow_up}${car.follow_up<=today ? " — due" : ""}`);
    if (latest) parts.push(`Last activity ${latest.at.slice(0,10)}${latest.note ? `: ${clean(latest.note).slice(0,400)}` : ""}`);
    return parts.join(". ")+".";
  };
  const worth = candidates.filter(car => car.price_cents != null && !car.detail_error && car.availability === "available" && !car.assessment.purchase_readiness.startsWith("Blocked")
      && (car.crm_status!=="Seller declined" || reconsider(car) || (car.follow_up && car.follow_up<=today)))
    .sort((a,b) => Number(Boolean(reconsider(b)))-Number(Boolean(reconsider(a))) || b.assessment.score-a.assessment.score || (b.assessment.age_days ?? -1)-(a.assessment.age_days ?? -1)).slice(0,5);
  const followups = cars.filter(car => car.follow_up && car.follow_up <= today && !["Pass","Bought"].includes(car.crm_status));
  const inquiryChanges=cars.filter(car=>(histories.get(car.id) ?? []).some(item=>item.at>=since));
  const renewed=active.filter(car=>reconsider(car));
  const line = (car: typeof cars[number]) => {
    const rating = car.assessment;
    const age = rating.age_days == null ? `listed age unknown; tracked ${rating.tracked_days}d` : `${rating.age_days}d listed`;
    return `- [${clean(car.title)}](${car.url}) — ${dollars(car.price_cents)}, ${clean(car.location)}, ${age}${rating.newly_listed ? " · newly listed" : ""}. **${rating.label}**. ${rating.summary.map(clean).join("; ")}.${car.crm_status!=="New" ? ` CRM: ${context(car)}` : ""}`;
  };
  const latest = store.scans()[0] as { status?: string; started_at?: string; summary?: { errors?: string[]; warnings?: string[]; queries?: {query:string;maxPrice:number}[] } } | undefined;
  const notes: string[] = [];
  if (!latest || latest.status === "running" || !latest.started_at || Date.parse(latest.started_at) < now.getTime()-18*3600000) notes.push("Scan coverage is missing, running or stale; do not treat this as a complete market check.");
  if (latest?.status === "partial" || latest?.status === "failed") notes.push(`Latest scan ${latest.status}; some listings were not refreshed.`);
  notes.push(...latest?.summary?.errors ?? [], ...latest?.summary?.warnings ?? []);
  if (latest?.summary?.queries) notes.push(`Searches: ${latest.summary.queries.map(query=>`${query.query} (up to C$${query.maxPrice})`).join(", ")}`);
  const inquiryLine=(car: Car)=>`- [${clean(car.title)}](${car.url}) — ${context(car)} Availability: ${clean(car.availability)}${car.detail_error ? "; latest refresh failed" : ""}.`;
  return { generated_at: now.toISOString(), since, new_cars: fresh.length, price_drops: drops.length, worthy: worth.length, negotiation_watch:negotiation.length, renewed_opportunities:renewed.length,
    markdown: `# Donor watch — ${today}\n\nCambridge–Kitchener · 50 km requested radius · VW/Audi · 1998–2015 focus · maximum C$1,200 asking; motivated sellers up to C$1,600 appear separately. Changes below cover the last 24 hours.\n\n## New cars (${fresh.length})\n\n${fresh.length ? fresh.map(line).join("\n") : "No newly discovered qualifying cars in the reporting window."}\n\n## Price drops (${drops.length})\n\n${drops.length ? drops.map(drop => { const car=cars.find(car=>car.id===drop.car_id)!; return `- [${clean(car.title)}](${car.url}): ${dollars(drop.previous_price)} → **${dollars(drop.price_cents)}** (${dollars(drop.previous_price-drop.price_cents)} lower, observed ${drop.observed_at.slice(0,10)}).${drop.price_cents!==car.price_cents ? ` Current asking is ${dollars(car.price_cents)}.` : ""}${car.crm_status!=="New" ? ` ${context(car)}` : ""}`; }).join("\n") : "No verified asking-price drops in the reporting window."}\n\n## Worth looking at\n\n${worth.length ? worth.map(line).join("\n") : "No current verified candidates to rank."}\n\n## Negotiation watch (${negotiation.length})\n\n${negotiation.length ? negotiation.map(line).join("\n") : "No qualifying above-budget negotiation leads."}\n\n## Your inquiries\n\n${followups.length ? followups.map(car=>`- Follow-up due ${car.follow_up}: [${clean(car.title)}](${car.url}) — ${context(car)} Availability: ${clean(car.availability)}.`).join("\n") : "No follow-ups due."}\n\n### Changed in the last 24 hours (${inquiryChanges.length})\n\n${inquiryChanges.length ? inquiryChanges.map(inquiryLine).join("\n") : "No inquiry activity recorded in this window."}\n\n### Reconsider after a seller decline (${renewed.length})\n\n${renewed.length ? renewed.map(inquiryLine).join("\n") : "No verified new price-drop opportunity after a recorded decline."}\n\n${notes.length ? `## Coverage\n\n${notes.map(note => `- ${clean(note)}`).join("\n")}\n\n` : ""}Judgments use the ad and your saved notes. Prices are asking prices in CAD.\n` };
}

export function dollars(cents: number | null) { return cents == null ? "unknown" : new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", currencyDisplay: "narrowSymbol", maximumFractionDigits: cents%100 ? 2 : 0 }).format(cents/100); }
function clean(text: string) { return text.replace(/[\r\n]+/g," ").replace(/[\[\]<>*_`]/g,""); }
