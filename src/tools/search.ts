import { z } from "zod";
import type { FacebookClient } from "../facebook/client.js";

export const searchListingsSchema = {
  query: z.string().trim().min(1).describe("Search query (e.g. 'macbook pro', 'couch')"),
  latitude: z.number().min(-90).max(90).describe("Latitude of search center"),
  longitude: z.number().min(-180).max(180).describe("Longitude of search center"),
  radius_km: z
    .number()
    .finite().positive()
    .default(50)
    .describe("Search radius in kilometers (default: 50)"),
  min_price: z
    .number()
    .finite().nonnegative()
    .optional()
    .describe("Minimum price filter in dollars"),
  max_price: z
    .number()
    .finite().nonnegative()
    .optional()
    .describe("Maximum price filter in dollars"),
  category: z
    .string()
    .optional()
    .describe("Category ID to filter by"),
  limit: z
    .number()
    .int().min(1).max(100)
    .default(20)
    .describe("Max number of results (default: 20)"),
  sort_by: z.enum(["suggested", "distance", "date_listed", "price_low_to_high", "price_high_to_low"]).optional(),
  delivery_method: z.enum(["all", "local_pickup", "shipping"]).optional(),
  date_listed: z.enum(["all", "last_24_hours", "last_7_days", "last_30_days"]).optional(),
  cursor: z.string().optional().describe("Continuation cursor from the previous provider page"),
};

export function createSearchHandler(client: Pick<FacebookClient, "searchListings">) {
  return async (args: {
    query: string;
    latitude: number;
    longitude: number;
    radius_km: number;
    min_price?: number;
    max_price?: number;
    category?: string;
    limit: number;
    sort_by?: "suggested" | "distance" | "date_listed" | "price_low_to_high" | "price_high_to_low";
    delivery_method?: "all" | "local_pickup" | "shipping";
    date_listed?: "all" | "last_24_hours" | "last_7_days" | "last_30_days";
    cursor?: string;
  }) => {
    try {
      if (args.min_price != null && args.max_price != null && args.min_price > args.max_price) {
        throw new Error("Minimum price cannot exceed maximum price");
      }
      const result = await client.searchListings({
        query: args.query,
        latitude: args.latitude,
        longitude: args.longitude,
        radiusKm: args.radius_km,
        minPrice: args.min_price,
        maxPrice: args.max_price,
        category: args.category,
        limit: args.limit,
        sortBy: args.sort_by,
        deliveryMethod: args.delivery_method,
        dateListed: args.date_listed,
        cursor: args.cursor,
      });

      if (result.listings.length === 0) {
        return {
          structuredContent: { ...result },
          content: [
            {
              type: "text" as const,
              text: `No listings found for "${args.query}" within ${args.radius_km}km.`,
            },
          ],
        };
      }

      const summary = result.listings
        .map(
          (l, i) =>
            `${i + 1}. **${l.title}** — ${l.price}\n   📍 ${l.location} | 👤 ${l.sellerName}${l.isPending ? " ⏳ PENDING" : ""}\n   🔗 ${l.url}`
        )
        .join("\n\n");

      const text = `Found ${result.listings.length} listings for "${args.query}":\n\n${summary}${result.hasNextPage ? "\n\n_More results available._" : ""}${result.omittedCount ? `\n\n${result.omittedCount} results from this page were omitted by the limit; increase limit to retrieve them. The cursor advances to the next provider page.` : ""}${result.endCursor ? `\n\nNext cursor: ${result.endCursor}` : ""}`;

      return {
        structuredContent: { ...result },
        content: [{ type: "text" as const, text }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error searching listings: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  };
}
