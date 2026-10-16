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

export const CATEGORIES = [
  { id: "model", label: "Model fit / demand", max: 20 },
  { id: "economics", label: "Acquisition cost", max: 20 },
  { id: "completeness", label: "Completeness", max: 15 },
  { id: "condition", label: "Rust / physical condition", max: 15 },
  { id: "mechanical", label: "Mechanical condition / testability", max: 10 },
  { id: "pickup", label: "Distance / pickup", max: 5 },
  { id: "age", label: "Listing age / negotiation", max: 5 },
  { id: "seller", label: "Listing information", max: 5 },
  { id: "documentation", label: "Ownership documentation", max: 5 },
] as const;
export type CategoryId = typeof CATEGORIES[number]["id"];
export interface Review {
  revision: number; at: string | null; pickup_cents: number | null;
  ratings: Partial<Record<CategoryId, { score: number | null; evidence: string }>>;
}
export const EMPTY_REVIEW: Review = { revision: 0, at: null, pickup_cents: null, ratings: {} };
const MODEL = /\b(jetta|golf|passat|rabbit|tiguan|beetle|cabrio|cabriolet|gli|gti|touareg|a[1-8]|q[1-8]|s[3-8]|rs[3-8]|allroad|tt)\b/i;

export function isVehicleTitle(title: string): boolean {
  return /\b(volkswagen|vw|audi|jetta|golf|passat|rabbit|tiguan|gti|gli|beetle)\b/i.test(title)
    || (/\b(?:19|20)\d{2}\b/.test(title) && MODEL.test(title));
}

export function assess(car: Car, now = new Date(), review: Review = EMPTY_REVIEW) {
  const title = car.title.toLowerCase(), text = `${title}\n${car.description.toLowerCase()}`;
  const age = ageDays(car.posted_at, now), distance = distanceKm(car.latitude, car.longitude);
  const reasons: string[] = [], checks: string[] = [];
  const whole = /\b(selling (?:the )?(?:whole|entire) car|whole (?:car|vehicle)|complete (?:car|vehicle)|take (?:the )?whole car)\b/.test(text);
  const year = Number(title.match(/\b((?:19|20)\d{2})\b/)?.[1]) || null;
  const modelFirstTitle = /^(?:(?:volkswagen|vw|audi)\s+)?(?:jetta|golf|passat|rabbit|gti|gli|beetle|a[1-8]|tt)\b/.test(title);
  const simpleModelTitle = /^(?:(?:volkswagen|vw|audi)\s+)?(?:jetta|golf|passat|rabbit|gti|gli|beetle|a[1-8]|tt)(?:\s+(?:tdi|gti|gli|city|quattro|manual|automatic))*$/.test(title);
  const vehicleContext = /\b(car|vehicle|sedan|hatchback|runs?|drives?|non[ -]?running)\b/.test(text);
  const identifiedCar = MODEL.test(title) && (year!=null || simpleModelTitle || (modelFirstTitle && vehicleContext));
  const nonVehicle = /\b(?:launch monitor|rapsodo|simulator|golf clubs?|golf bag|golf balls?|putter)\b/.test(title);
  const repairTitle = identifiedCar && /\b(issue|problem|needs|blown|broken|fault|seized)\b/.test(title);
  const component = /\b(engine|motor|transmission|transnission|turbo|strut|door|hood|bumper|headlight|tail light|trunk|exhaust|wheels|rims|tires|seats|suspension|calipers|springs|axle|brake|mirror|fender|side skirts?|grill[e]?|spoiler|splitter|diffuser|radio|stereo|coilovers?|alternator|starter|compressor|radiator|5x112|fat fives|injectors?|ecu|steering wheel)\b/.test(title);
  const partOut = /\b(part[ -]?out|parting out|for parts)\b/.test(text);
  const missing = /\b(?:engine|motor|transmission|gearbox|interior|modules?) (?:already )?(?:sold|missing|removed)\b|\b(?:no|missing|removed) (?:engine|motor|transmission|gearbox|interior)\b/.test(text);
  const sellingParts = /\b(?:lmk|let me know) what (?:parts|you need)|\b(?:doors?|engine|transmission) (?:already )?sold\b|\bparts? prices?\b/.test(text);
  const shell = /\b(?:bare |rolling )?shell\b/.test(title);
  const parts = nonVehicle || !isVehicleTitle(title) || (!whole && (!identifiedCar || sellingParts || shell || (component && !repairTitle)));
  const vehicleKind = parts ? "Individual parts / shell" : missing ? "Partially dismantled donor" : whole ? "Whole-car offer" : partOut ? "Possible whole donor — confirm" : "Vehicle — completeness unknown";
  const suspiciousPrice = car.price_cents != null && car.price_cents < 20000;
  const outOfBudget = car.price_cents != null && car.price_cents > SEARCH.maxPrice * 100;
  const motivated = /\b(need(?:s)? (?:it )?gone|must go|make (?:me )?an offer|obo|moving|best offer)\b/.test(text);
  const negotiationOnly = outOfBudget && car.price_cents! <= 160000 && motivated;
  const outsideArea = distance != null && distance > SEARCH.radiusKm;
  const outsideYears = year != null && (year < 1998 || year > 2015);
  const eligible = !parts && !suspiciousPrice && !outOfBudget && !outsideArea && !outsideYears;
  const watch = negotiationOnly && !parts && !suspiciousPrice && !outsideArea && !outsideYears;
  if (parts) reasons.push("Likely individual-parts advertisement or shell");
  if (suspiciousPrice) checks.push("Confirm the advertised price buys the whole car");
  if (outOfBudget) reasons.push(watch ? "Negotiation watch only; above C$1,200 ceiling" : "Above C$1,200 ceiling");
  if (outsideArea) reasons.push(`Outside 50 km radius (${distance?.toFixed(1)} km straight-line)`);
  if (outsideYears) reasons.push("Outside initial 1998–2015 model-year focus");
  if (year == null) checks.push("Model year unverified");
  if (car.price_cents == null) checks.push("Asking price is unknown");
  if (partOut && !parts) checks.push("Confirm the whole car is available and which parts have been removed");

  type Evidence = { score: number | null; evidence: string; source: string };
  const auto: Record<CategoryId, Evidence> = Object.fromEntries(CATEGORIES.map(category => [category.id, { score: null, evidence: "Unknown — needs evidence", source: "unknown" }])) as Record<CategoryId, Evidence>;
  const set = (id: CategoryId, score: number, evidence: string, source = "Seller report") => { auto[id] = { score, evidence, source }; };
  if (/\b(jetta|golf|rabbit|gti|gli|a3)\b/.test(title)) set("model",16,"Core commuter-donor target; actual parts demand uncalibrated","Target policy");
  else if (/\b(a4|a6|tt|passat|beetle|cabrio|cabriolet)\b/.test(title)) set("model",12,"Secondary target; confirm generation and trim demand","Target policy");
  else if (MODEL.test(title)) set("model",6,"Lower fit with the initial commuter-donor focus","Target policy");
  const allIn = car.price_cents != null && review.pickup_cents != null ? car.price_cents + review.pickup_cents : null;
  if (allIn != null) set("economics",allIn <= 70000 ? 20 : allIn <= 90000 ? 15 : allIn <= 120000 ? 10 : 5,
    `Asking plus your pickup estimate: C$${(allIn/100).toFixed(2)}; cost screen only, no recovery forecast`,"Calculated cost");
  else checks.push("Add a pickup cost estimate; acquisition economics remain incomplete");
  if (shell) set("completeness",0,"Shell advertised; useful assemblies must be identified");
  else if (/\b(?:substantially stripped|mostly stripped|stripped car)\b/.test(text)) set("completeness",5,"Seller describes a stripped vehicle");
  else if (missing) set("completeness",10,"Major assembly reported missing; remaining parts need confirmation");
  else if (whole && /\bcomplete\b/.test(text)) set("completeness",15,"Seller describes a complete car; not inspected");
  else if (whole) checks.push("Whole-car sale does not prove that all assemblies remain");
  if (/\b(?:severe|structural|extensive|heavy) rust|rusted (?:out|through)|rotted (?:out|frame|subframe)\b/.test(text)) set("condition",5,"Serious corrosion reported; inspect individual recoverable parts");
  else if (/\b(?:rocker|rockers|surface|localized|minor|moderate) rust|rust(?:y)? rockers?\b/.test(text)) set("condition",10,"Localized/moderate corrosion reported; extent unverified");
  else if (/\b(?:no rust|rust[ -]?free|minimal rust)\b/.test(text)) set("condition",15,"Seller reports little/no rust; hidden corrosion unverified");
  else if (/\b(?:rust|rough shape|collision|accident|damage)\b/.test(text)) checks.push("Rust/body condition needs inspection");
  const nonRunning = /does not run|doesn't run|non[ -]?runn|not (?:been )?started|won't start|does not start|seized|blown engine|engine blown/.test(text);
  const driveFault = /(?:does not|doesn't|won't|not) drive|transmission (?:issue|problem|fail)|needs (?:a )?(?:new )?transmission/.test(text);
  if (/no keys|missing keys/.test(text)) { set("mechanical",2,"No keys; operation unverified"); checks.push("No keys; engine operation unverified"); }
  else if (nonRunning) set("mechanical",/seized|blown/.test(text) ? 2 : 4,"Non-running/untested drivetrain; do not assume engine or gearbox recovery");
  else if (driveFault) set("mechanical",4,"Drive/transmission fault reported; remaining systems may still be testable");
  else if (/\b(?:runs? (?:and |& )?drives?|runs and drives)\b/.test(text)) set("mechanical",10,"Seller reports it runs and drives; not independently tested");
  else if (/\b(?:starts|runs strong|run strong)\b|engine.{0,40}(?:running great|runs? (?:great|well|strong))/.test(text)) set("mechanical",7,"Seller reports it starts/runs; driving condition unverified");
  if (/overheat|head gasket/.test(text)) checks.push("Overheating/head-gasket risk; engine value unproven");
  if (/coolant leak|ground issue|wiring issue|battery.{0,20}drain|kill (?:a )?switch/.test(text)) checks.push("Cooling/electrical fault reported; affected component recovery unproven");
  if (/front.end damage|collision|accident damage/.test(text)) checks.push("Collision/body damage; inspect recoverable parts");
  if (/\bmodified\b|\btune\b|\btuning\b/.test(text)) checks.push("Modified setup; confirm which OEM parts remain");
  if (distance != null) set("pickup",distance <= 20 ? 5 : 3,"Straight-line distance only; access and actual towing cost need confirmation","Listing coordinates");
  else checks.push("Exact distance unverified; location is approximate");
  if (age != null) set("age",age >= 45 ? 5 : age >= 21 ? 4 : age >= 7 ? 3 : age >= 2 ? 2 : 1,`${age} days listed; age may help negotiation, not proof of seller flexibility`,"Listing timestamp");
  else checks.push("Facebook listed date unavailable; tracked age is separate");
  set("seller",car.description.trim().length >= 250 && car.image_url ? 5 : car.description.trim().length >= 80 ? 3 : 1,"Information available in the ad; not a seller trust assessment","Listing information");
  const ownershipProblem = /no (?:ownership|title|papers)|(?:ownership|title) (?:missing|problem|not available)|lien (?:outstanding|owing)/.test(text);
  if (ownershipProblem) set("documentation",0,"Ownership/paperwork problem reported; resolve before purchase");
  else if (/\b(?:have|has|with|includes?|clean) (?:the )?(?:ownership|title)|ownership (?:in hand|available)/.test(text)) set("documentation",2,"Seller claims ownership paperwork; right to sell and liens unverified");
  checks.push("Verify seller's right to sell and ownership/lien documentation before purchase");
  if (/firm\b/.test(text)) checks.push("Seller currently says price is firm");
  if (car.detail_error) checks.push("Latest detail refresh failed; retained facts may be stale");
  const stale = !car.last_detail_at || now.getTime()-Date.parse(car.last_detail_at) > 36*3600000;
  if (stale) checks.push("Listing evidence is over 36 hours old or has never been refreshed");
  if (["pending", "sold"].includes(car.availability)) checks.push(`Facebook marks this listing ${car.availability}`);
  const categories = CATEGORIES.map(category => ({ ...category, ...(review.ratings[category.id] ? { ...review.ratings[category.id]!, source: "Your review" } : auto[category.id]) }));
  const score = categories.reduce((sum, category) => sum + (category.score ?? 0),0);
  const coverage = categories.reduce((sum, category) => sum + (category.score == null ? 0 : category.max),0);
  const reviewed = categories.filter(category => category.source === "Your review" && category.score != null).reduce((sum, category) => sum+category.max,0);
  const scoreMax = score + 100-coverage;
  const confidence = coverage < 60 || stale || car.detail_error ? "Low" : coverage >= 85 && reviewed >= 50 ? "High" : "Medium";
  const ownershipBlocked = categories.find(category=>category.id==="documentation")?.score===0 || (ownershipProblem && review.ratings.documentation?.score!==5);
  const purchaseReadiness = ownershipBlocked ? "Blocked — ownership issue" : "Due diligence required before purchase";
  const label = !eligible && !watch ? "Outside shortlist" : watch ? "Negotiation watch" : ownershipBlocked ? "Ownership issue — resolve first" : car.price_cents == null || stale || car.detail_error || car.availability !== "available" ? "Needs checks" : coverage < 60 ? "Needs evidence" : score >= 80 && confidence === "High" ? "Contact now" : score >= 65 ? "Investigate" : scoreMax >= 65 ? "Investigate — incomplete" : score >= 50 ? "Watch / lower offer" : "Low priority";
  for (const category of categories) if (category.score != null && category.id !== "seller") reasons.push(`${category.label}: ${category.score}/${category.max} — ${category.evidence}`);
  return { eligible, negotiation_watch: watch, score, score_max: scoreMax, coverage, confidence, categories, label, purchase_readiness: purchaseReadiness, vehicle_kind: vehicleKind, all_in_cents: allIn,
    reasons, checks, age_days: age, newly_listed: age != null && age < 2, tracked_days: ageDays(car.first_seen_at, now) ?? 0, distance_km: distance==null?null:Math.round(distance*10)/10, suspicious_price: suspiciousPrice };
}

export function detailFields(detail: MarketplaceListingDetail) {
  return { title: detail.title, description: detail.description, location: detail.location, seller: detail.sellerName,
    image_url: detail.imageUrl, price_cents: moneyCents(detail.price), price_text: detail.price,
    posted_at: detail.postedDate && Number.isFinite(Date.parse(detail.postedDate)) && Date.parse(detail.postedDate)>=Date.UTC(2000,0,1) ? detail.postedDate : null,
    availability: detail.isSold ? "sold" : detail.isPending ? "pending" : "available",
    latitude: detail.latitude ?? null, longitude: detail.longitude ?? null };
}
