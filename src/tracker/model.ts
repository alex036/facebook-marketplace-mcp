import type { MarketplaceListingDetail } from "../facebook/types.js";

export const SEARCH = { latitude: 43.3581, longitude: -80.3114, radiusKm: 50, maxPrice: 1200 };
export const STATUSES = ["New", "Interested", "Contacted", "Offer sent", "Seller declined", "Follow up", "Deal agreed", "Bought", "Pass"] as const;
export type CrmStatus = typeof STATUSES[number];

export interface Car {
  id: string; title: string; description: string; location: string; seller: string;
  url: string; image_url: string; price_cents: number | null; price_text: string;
  first_price_cents: number | null; posted_at: string | null; first_seen_at: string;
  last_seen_at: string; last_search_at: string | null; last_detail_at: string | null;
  availability: string; latitude: number | null; longitude: number | null;
  detail_error: string | null; crm_status: CrmStatus; offer_cents: number | null;
  counter_cents: number | null; follow_up: string | null; crm_revision: number;
}

export function moneyCents(value: string): number | null {
  const text = value.trim();
  if (/^(free|gratuit)$/i.test(text)) return 0;
  // This tracker searches Ontario CAD listings; reject other explicit currencies and ranges.
  if (/USD|US\$|EUR|GBP|€|£/i.test(text)) return null;
  const match = text.match(/^(?:(?:CAD|CA\$|C\$|\$)\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?:\s*CAD)?$/i);
  if (!match) return null;
  const cents = Number(match[1].replaceAll(",", "")) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function ageDays(posted: string | null, now = new Date()): number | null {
  if (!posted) return null;
  const ms = Date.parse(posted);
  return Number.isFinite(ms) && ms <= now.getTime() ? Math.floor((now.getTime() - ms) / 86400000) : null;
}

export function distanceKm(latitude: number | null, longitude: number | null): number | null {
  if (latitude == null || longitude == null) return null;
  const rad = (n: number) => n * Math.PI / 180;
  const a = Math.sin(rad(latitude - SEARCH.latitude) / 2) ** 2 + Math.cos(rad(SEARCH.latitude)) * Math.cos(rad(latitude)) * Math.sin(rad(longitude - SEARCH.longitude) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isVehicleTitle(title: string): boolean {
  return /\b(volkswagen|vw|audi|jetta|golf|passat|rabbit|tiguan)\b/i.test(title);
}

export function assess(car: Car, now = new Date()) {
  const title = car.title.toLowerCase(), text = `${title}\n${car.description.toLowerCase()}`;
  const age = ageDays(car.posted_at, now), distance = distanceKm(car.latitude, car.longitude);
  const reasons: string[] = [], checks: string[] = [];
  let score = 0;
  const whole = /\b(selling (?:the )?(?:whole|entire) car|whole (?:car|vehicle)|complete (?:car|vehicle))\b/.test(text);
  const identifiedCar = /\b(?:19|20)\d{2}\b/.test(title) && /\b(jetta|golf|passat|rabbit|tiguan|beetle|cabrio|cabriolet|gli|gti|touareg|a[1-8]|q[1-8]|s[3-8]|rs[3-8]|allroad)\b/.test(title);
  const repairTitle = identifiedCar && /\b(issue|problem|needs|blown|broken|fault|seized)\b/.test(title);
  const component = /\b(engine|motor|transmission|turbo|strut|door|hood|bumper|headlight|tail light|trunk|exhaust|wheels|rims|tires|seats|suspension|calipers|springs|axle|brake|mirror|fender)\b/.test(title);
  const sellingParts = /\b(?:lmk|let me know) what parts|\b(?:doors?|engine|transmission) (?:already )?sold\b|\bparts? prices?\b/.test(text);
  const parts = !isVehicleTitle(title) || (!whole && (!identifiedCar || sellingParts || /\b(part[ -]?out|parting out|frame|shell)\b/.test(title) || (component && !repairTitle)));
  const suspiciousPrice = car.price_cents != null && car.price_cents < 20000;
  const outOfBudget = car.price_cents != null && car.price_cents > SEARCH.maxPrice * 100;
  const outsideArea = distance != null && distance > SEARCH.radiusKm;
  const eligible = !parts && !suspiciousPrice && !outOfBudget && !outsideArea;
  if (parts) reasons.push("Likely parts advertisement or outside VW/Audi scope");
  if (suspiciousPrice) checks.push("Confirm the advertised price buys the whole car");
  if (outOfBudget) reasons.push("Above C$1,200 ceiling");
  if (outsideArea) reasons.push(`Outside 50 km radius (${distance?.toFixed(1)} km straight-line)`);
  if (car.price_cents == null) checks.push("Asking price is unknown");
  else if (car.price_cents >= 20000 && car.price_cents <= 75000) { score += 3; reasons.push("Lower entry price"); }
  else if (!outOfBudget) { score += 1; reasons.push("Within asking-price ceiling"); }
  if (/\b(jetta|golf|rabbit|a3|a4|passat)\b/.test(title)) { score += 2; reasons.push("Fits commuter-car focus"); }
  else checks.push("Confirm this model fits the donor focus");
  if (age != null && age >= 30) { score += 2; reasons.push(`${age} days listed — useful offer leverage`); }
  else if (age != null && age >= 14) { score += 1; reasons.push(`${age} days listed — worth negotiating`); }
  if (age == null) checks.push("Facebook listed date unavailable; tracked age is separate");
  if (/\b(runs and drives|runs? (?:and |& )?drives?|starts and stops|run strong|runs strong)\b|engine.{0,40}(?:running great|runs? (?:great|well|strong))/.test(text)) { score++; reasons.push("Seller reports it runs"); }
  if (/does not run|doesn't run|non[ -]?runn|not (?:been )?started|won't start|does not start/.test(text)) { score--; checks.push("Running condition unproven or non-running"); }
  if (/overheat|head gasket/.test(text)) { score -= 2; checks.push("Overheating/head-gasket risk; engine value unproven"); }
  if (/transmission (?:issue|problem|fail)|needs (?:a )?(?:new )?transmission/.test(text)) { score -= 2; checks.push("Transmission fault; do not assume drivetrain recovery"); }
  if (/coolant leak|ground issue|wiring issue/.test(text)) { score--; checks.push("Cooling or electrical fault"); }
  if (/battery.{0,20}drain|kill (?:a )?switch/.test(text)) checks.push("Battery drain or workaround reported; electrical condition needs checking");
  if (/no keys|missing keys/.test(text)) { score--; checks.push("No keys; engine operation unverified"); }
  if (/front.end damage|collision|accident damage/.test(text)) { score--; checks.push("Collision/body damage; inspect recoverable parts"); }
  if (/coil spring|broken springs|suspension.{0,20}shot/.test(text)) checks.push("Suspension fault; confirm towing arrangements");
  if (/rust|rough shape|body.{0,20}rough/.test(text)) checks.push("Rust/body condition needs inspection");
  if (/\bmodified\b|\btune\b|\btuning\b/.test(text)) { score--; checks.push("Modified setup; confirm which OEM parts remain"); }
  if (/tow truck|trailer|towed|flatbed/.test(text)) checks.push("Add towing cost before deciding");
  if (/firm\b/.test(text)) checks.push("Seller currently says price is firm");
  if (distance == null) checks.push("Exact distance unverified; location is approximate");
  if (car.detail_error) checks.push("Latest detail refresh failed; retained facts may be stale");
  if (["pending", "sold"].includes(car.availability)) checks.push(`Facebook marks this listing ${car.availability}`);
  const label = !eligible ? "Outside shortlist" : car.price_cents == null || car.detail_error || car.availability !== "available" ? "Needs checks" : score >= 6 ? "Worth a look" : score >= 3 ? "Negotiate / inspect" : "Watch / lower offer";
  return { eligible, score, label, reasons, checks, age_days: age, tracked_days: ageDays(car.first_seen_at, now) ?? 0, distance_km: distance==null?null:Math.round(distance*10)/10, suspicious_price: suspiciousPrice };
}

export function detailFields(detail: MarketplaceListingDetail) {
  return { title: detail.title, description: detail.description, location: detail.location, seller: detail.sellerName,
    image_url: detail.imageUrl, price_cents: moneyCents(detail.price), price_text: detail.price,
    posted_at: detail.postedDate && Number.isFinite(Date.parse(detail.postedDate)) && Date.parse(detail.postedDate)>=Date.UTC(2000,0,1) ? detail.postedDate : null,
    availability: detail.isSold ? "sold" : detail.isPending ? "pending" : "available",
    latitude: detail.latitude ?? null, longitude: detail.longitude ?? null };
}
