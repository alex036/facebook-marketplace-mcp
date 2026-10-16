import { assess, type Car } from "./model.js";
import { TrackerStore } from "./store.js";

export function report(store: TrackerStore, now = new Date()) {
  const since = new Date(now.getTime()-24*60*60*1000).toISOString();
  const cars = store.view(now);
  const candidates = cars.filter(car => car.assessment.eligible && !["Pass", "Bought"].includes(car.crm_status) && car.availability !== "sold");
  const fresh = candidates.filter(car => car.first_seen_at >= since);
  const drops = store.drops(since).filter(drop => candidates.some(car => car.id === drop.car_id));
  const worth = candidates.filter(car => car.price_cents != null && !car.detail_error && car.availability === "available")
    .sort((a,b) => b.assessment.score-a.assessment.score || (b.assessment.age_days ?? -1)-(a.assessment.age_days ?? -1)).slice(0,5);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const followups = candidates.filter(car => car.follow_up && car.follow_up <= today);
  const declines = cars.filter(car => car.crm_status === "Seller declined");
  const line = (car: Car) => {
    const rating = assess(car, now);
    const age = rating.age_days == null ? `listed age unknown; tracked ${rating.tracked_days}d` : `${rating.age_days}d listed`;
    return `- [${clean(car.title)}](${car.url}) — ${dollars(car.price_cents)}, ${clean(car.location)}, ${age}. **${rating.label}**. ${rating.reasons.join("; ")}. ${rating.checks.length ? `Check: ${rating.checks.join("; ")}.` : ""}`;
  };
  const latest = store.scans()[0] as { status?: string; started_at?: string; summary?: { errors?: string[]; warnings?: string[] } } | undefined;
  const notes: string[] = [];
  if (!latest || latest.status === "running" || !latest.started_at || Date.parse(latest.started_at) < now.getTime()-18*3600000) notes.push("Scan coverage is missing, running or stale; do not treat this as a complete market check.");
  if (latest?.status === "partial" || latest?.status === "failed") notes.push(`Latest scan ${latest.status}; some listings were not refreshed.`);
  notes.push(...latest?.summary?.warnings ?? []);
  return { generated_at: now.toISOString(), since, new_cars: fresh.length, price_drops: drops.length, worthy: worth.length,
    markdown: `# Donor watch — ${today}\n\nCambridge–Kitchener · 50 km requested radius · VW/Audi · maximum C$1,200 asking. Changes below cover the last 24 hours.\n\n## New cars (${fresh.length})\n\n${fresh.length ? fresh.map(line).join("\n") : "No newly discovered qualifying cars in the reporting window."}\n\n## Price drops (${drops.length})\n\n${drops.length ? drops.map(drop => { const car=store.get(drop.car_id)!; return `- [${clean(car.title)}](${car.url}): ${dollars(drop.previous_price)} → **${dollars(drop.price_cents)}** (${dollars(drop.previous_price-drop.price_cents)} lower).`; }).join("\n") : "No verified asking-price drops in the reporting window."}\n\n## Worth looking at\n\n${worth.length ? worth.map(line).join("\n") : "No current verified candidates to rank."}\n\n## Your inquiries\n\n${followups.length ? followups.map(car => `- Follow-up due ${car.follow_up}: [${clean(car.title)}](${car.url}) — ${car.crm_status}; your offer ${dollars(car.offer_cents)}; seller counter ${dollars(car.counter_cents)}.`).join("\n") : "No follow-ups due."}\n${declines.length ? `\n${declines.length} seller-declined inquiries remain in the CRM; no automatic re-contact.\n` : ""}\n${notes.length ? `## Coverage\n\n${notes.map(note => `- ${clean(note)}`).join("\n")}\n\n` : ""}Ratings are screening priorities, not profit estimates. Older ads improve negotiation priority, not proof that a seller will accept less. Sold/removed ads do not reveal the transaction price.\n` };
}

export function dollars(cents: number | null) { return cents == null ? "unknown" : new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", currencyDisplay: "narrowSymbol", maximumFractionDigits: cents%100 ? 2 : 0 }).format(cents/100); }
function clean(text: string) { return text.replace(/[\r\n]+/g," ").replace(/[\[\]<>*_`]/g,""); }
