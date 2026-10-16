import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { FacebookClient } from "../src/facebook/client.js";
import { resolveBrowserName, resolveBrowserProfile } from "../src/facebook/auth.js";
import { parseListingDetailFromPage, parseSearchResponse } from "../src/facebook/parser.js";
import { RateLimiter } from "../src/utils/rate-limit.js";
import { createSearchHandler, searchListingsSchema } from "../src/tools/search.js";
import { buildDateListedWindow, buildSearchVariables } from "../src/facebook/queries.js";

const session = { cookies: [], cookieHeader: "test", userId: "test", fbDtsg: "test", lsd: "test", jazoest: "test", clientRevision: "1" };
const params = { query: "Volkswagen as is", latitude: 43.3581, longitude: -80.3114, radiusKm: 50, maxPrice: 1200, limit: 1 };
const page = (data: unknown) => '<script type="application/json">' + JSON.stringify(data) + '</script>';

test("does not borrow prices, descriptions or pending status from another listing", () => {
  const html = page({ related: { id: "222", marketplace_listing_title: "Wrong", listing_price: { formatted_amount: "CA$2,000" }, redacted_description: { text: "Wrong description" }, is_pending: true }, requested: { id: "111", marketplace_listing_title: "Jetta", listing_price: { formatted_amount_zeros_stripped: "CA$500" }, redacted_description: { text: '500 firm\nSeller says: "as is"' }, creation_time: 1e30 } });
  const result = parseListingDetailFromPage(html, "111");
  assert.equal(result.price, "CA$500");
  assert.equal(result.description, '500 firm\nSeller says: "as is"');
  assert.equal(result.isPending, false);
  assert.equal(result.postedDate, "");
  assert.equal(parseListingDetailFromPage(html, "333").price, "");
});

test("keeps skeleton search IDs for hydration rather than internal feed IDs", () => {
  const result = parseSearchResponse({ data: { marketplace_search: { feed_units: { edges: [{ node: { id: "internal-feed-id", story_key: "111" } }], page_info: { has_next_page: true, end_cursor: "next" } } } } });
  assert.equal(result.listings[0].id, "111");
  assert.equal(result.listings[0].needsHydration, true);
  assert.equal(result.endCursor, "next");
});

test("raw amounts retain currency and currency alone is not a price", () => {
  assert.equal(parseListingDetailFromPage(page({ id: "111", listing_price: { amount: "500.00", currency: "CAD" } }), "111").price, "CAD 500.00");
  assert.equal(parseListingDetailFromPage(page({ id: "111", listing_price: { currency: "CAD" } }), "111").price, "");
});

test("untrusted Relay keys cannot modify object prototypes", () => {
  const html = '<script type="application/json">{"id":"111","marketplace_listing_title":"Jetta","__proto__":{"polluted":true}}</script>';
  assert.equal(parseListingDetailFromPage(html, "111").title, "Jetta");
  assert.equal("polluted" in {}, false);
});

test("limits before hydration and discloses omitted current-page results", async t => {
  t.mock.method(RateLimiter.prototype, "wait", async () => {});
  const client = new FacebookClient();
  t.mock.method(client, "ensureSession", async () => session);
  const requested: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input); requested.push(url);
    if (url.includes("/api/graphql/")) return new Response(JSON.stringify({ data: { marketplace_search: { feed_units: { edges: [{ node: { story_key: "111" } }, { node: { story_key: "222" } }], page_info: { end_cursor: "next", has_next_page: true } } } } }));
    return new Response(page({ id: "111", marketplace_listing_title: "Jetta", listing_price: { formatted_amount: "CA$500" } }));
  });
  const result = await client.searchListings(params);
  assert.equal(result.listings.length, 1);
  assert.equal(result.listings[0].price, "CA$500");
  assert.equal(result.listings[0].needsHydration, undefined);
  assert.equal(result.omittedCount, 1);
  assert.equal(requested.filter(url => url.includes("/item/")).length, 1);
});

test("GraphQL parse errors are sanitized and error-only responses fail", async t => {
  t.mock.method(RateLimiter.prototype, "wait", async () => {});
  const client = new FacebookClient();
  t.mock.method(client, "ensureSession", async () => session);
  let response = '<html>private-account-marker</html>';
  t.mock.method(globalThis, "fetch", async () => new Response(response));
  await assert.rejects(client.searchListings(params), error => error instanceof Error && error.message === "Failed to parse GraphQL response");
  response = JSON.stringify({ errors: [{ message: "private-account-marker" }] });
  await assert.rejects(client.searchListings(params), /no usable GraphQL data/);
});

test("unavailable or login pages do not become empty successful listings", async t => {
  t.mock.method(RateLimiter.prototype, "wait", async () => {});
  const client = new FacebookClient();
  t.mock.method(client, "ensureSession", async () => session);
  t.mock.method(globalThis, "fetch", async () => new Response("<html>Please log in</html>"));
  await assert.rejects(client.getListingDetail("111"), /Could not verify listing/);
});

test("accepts profile display names and prefers modern cookie paths", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "marketplace-profile-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  t.mock.method(os, "homedir", () => dir);
  const chrome = path.join(dir, "Library/Application Support/Google/Chrome");
  fs.mkdirSync(path.join(chrome, "Profile 1/Network"), { recursive: true });
  fs.writeFileSync(path.join(chrome, "Profile 1/Network/Cookies"), "synthetic");
  fs.writeFileSync(path.join(chrome, "Local State"), JSON.stringify({ profile: { info_cache: { "Profile 1": { name: "Person 1" } } } }));
  assert.equal(resolveBrowserProfile("Profile 1"), "Profile 1");
  assert.equal(resolveBrowserProfile(" person 1 "), "Profile 1");
  assert.throws(() => resolveBrowserProfile("Missing"), /Profile 1 \(Person 1\)/);
});

test("rejects invalid browser names and invalid rate configurations", () => {
  assert.equal(resolveBrowserName(" Chrome "), "chrome");
  for (const value of ["constructor", "__proto__", "firefox"]) assert.throws(() => resolveBrowserName(value), /Unsupported browser/);
  for (const value of [0, -1, 0.5, NaN, Infinity]) assert.throws(() => new RateLimiter(value), /positive integer/);
});

test("search options preserve old names and forward new filters and cursors", async () => {
  const args = z.object(searchListingsSchema).parse({ query: "Audi as is", latitude: 43, longitude: -80, max_price: 1200, sort_by: "date_listed", delivery_method: "local_pickup", date_listed: "last_7_days", cursor: "next" });
  let received: unknown;
  const result = await createSearchHandler({ async searchListings(value) { received = value; return { listings: [], hasNextPage: false, endCursor: null }; } })(args);
  assert.deepEqual(received, { query: args.query, latitude: 43, longitude: -80, radiusKm: 50, minPrice: undefined, maxPrice: 1200, category: undefined, limit: 20, sortBy: "date_listed", deliveryMethod: "local_pickup", dateListed: "last_7_days", cursor: "next" });
  assert.deepEqual(result.structuredContent?.listings, []);
  assert.throws(() => z.object(searchListingsSchema).parse({ ...args, limit: 0 }));
  const invalid = await createSearchHandler({ async searchListings() { throw new Error("must not be called"); } })({ ...args, min_price: 1300 });
  assert.equal(invalid.isError, true);
});

test("sort, delivery, date and price variables retain upstream mappings", () => {
  const variables = buildSearchVariables({ ...params, sortBy: "date_listed", deliveryMethod: "local_pickup" });
  const browse = (variables.params as { browse_request_params: Record<string, unknown> }).browse_request_params;
  assert.equal(browse.filter_price_upper_bound, 120000);
  assert.equal(browse.commerce_search_sort_by, "CREATION_TIME_DESCEND");
  assert.equal(browse.commerce_enable_shipping, false);
  assert.equal(buildDateListedWindow("last_24_hours", 20699), "20699;20698");
  const zero = buildSearchVariables({ ...params, maxPrice: 0 });
  assert.equal((zero.params as { browse_request_params: Record<string, unknown> }).browse_request_params.filter_price_upper_bound, 0);
});
