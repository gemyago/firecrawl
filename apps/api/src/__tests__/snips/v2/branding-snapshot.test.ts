import {
  concurrentIf,
  HAS_AI,
  TEST_PRODUCTION,
  TEST_SUITE_WEBSITE,
} from "../lib";
import { scrape, scrapeTimeout, idmux, Identity } from "./lib";

// Controlled test-site URLs - stable, use snapshots
const snapshotTestUrls = [
  // SVG logo with bright colors and light theme
  "/branding/svg-logo",
  // PNG logo with professional color scheme
  "/branding/png-logo",
  // Text-only branding without logo
  "/branding/no-logo",
  // Dark theme with transparency and glassmorphism
  "/branding/dark-transparent",
  // Complex branding with gradients, multiple colors, and varied typography
  "/branding/complex",
];

// External production URLs - use structure validation only (these change frequently)
const productionTestUrls = [
  // Firecrawl.dev homepage
  "https://firecrawl.dev",
  // Supabase.com homepage
  "https://supabase.com",
  // Upstash.com homepage
  "https://upstash.com",
  // Vercel.com homepage
  "https://vercel.com",
];

let identity: Identity;

beforeAll(async () => {
  identity = await idmux({
    name: "branding-snapshot",
    concurrency: 100,
    credits: 1000000,
  });
}, 10000 + scrapeTimeout);

/**
 * Normalize branding output for consistent snapshots.
 * This removes non-deterministic fields like timestamps, URLs that might change, etc.
 */
function normalizeBrandingOutput(branding: any): any {
  if (!branding) {
    return null;
  }

  const normalized = JSON.parse(JSON.stringify(branding));

  // Normalize logo URLs - keep the domain but normalize the path
  if (normalized.logo) {
    try {
      const logoUrl = new URL(normalized.logo);
      normalized.logo = `${logoUrl.origin}${logoUrl.pathname}`;
    } catch {
      // If URL parsing fails, keep as is
    }
  }

  // Normalize image URLs
  if (normalized.images) {
    Object.keys(normalized.images).forEach(key => {
      if (normalized.images[key]) {
        try {
          const imageUrl = new URL(normalized.images[key]);
          normalized.images[key] = `${imageUrl.origin}${imageUrl.pathname}`;
        } catch {
          // If URL parsing fails, keep as is
        }
      }
    });
  }

  // Remove debug fields that might change
  delete normalized.__llm_button_reasoning;
  delete normalized.__button_snapshots;
  delete normalized.__input_snapshots;

  // Sort object keys for consistent ordering
  return sortObjectKeys(normalized);
}

/**
 * Recursively sort object keys for consistent snapshot comparison
 */
function sortObjectKeys(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sortObjectKeys(item));
  }

  if (typeof obj === "object") {
    const sorted: any = {};
    Object.keys(obj)
      .sort()
      .forEach(key => {
        sorted[key] = sortObjectKeys(obj[key]);
      });
    return sorted;
  }

  return obj;
}

describe("Branding Format Snapshot Tests", () => {
  describe("Branding output snapshots (controlled test sites)", () => {
    // Only use snapshots for controlled test-site URLs that are stable
    snapshotTestUrls.forEach((brandingUrl: string) => {
      concurrentIf(TEST_PRODUCTION || HAS_AI)(
        `Should match branding snapshot for ${brandingUrl}`,
        async () => {
          // Resolve URL - if it starts with /, prepend TEST_SUITE_WEBSITE
          const testUrl = brandingUrl.startsWith("/")
            ? `${TEST_SUITE_WEBSITE}${brandingUrl}`
            : brandingUrl;

          const response = await scrape(
            {
              url: testUrl,
              formats: [{ type: "branding" }],
            },
            identity,
          );

          expect(response.branding).toBeDefined();

          const branding = response.branding;
          const normalizedBranding = normalizeBrandingOutput(branding);

          // Use Jest snapshot to compare the branding output
          // The snapshot file will be created automatically on first run
          // Update snapshots by running: npm test -- branding-snapshot.test.ts -u
          expect(normalizedBranding).toMatchSnapshot();
        },
        scrapeTimeout,
      );
    });
  });

  describe("Branding structure validation (production sites)", () => {
    // For external production sites, only validate structure (not exact output)
    // These sites change frequently, so snapshots would be too brittle
    productionTestUrls.forEach((brandingUrl: string) => {
      concurrentIf(TEST_PRODUCTION || HAS_AI)(
        `Should return valid branding structure for ${brandingUrl}`,
        async () => {
          const response = await scrape(
            {
              url: brandingUrl,
              formats: [{ type: "branding" }],
            },
            identity,
          );

          expect(response.branding).toBeDefined();

          const branding = response.branding;

          // Validate that branding has expected structure
          // Colors should be present
          if (branding?.colors) {
            expect(typeof branding.colors).toBe("object");
          }

          // Typography should be present
          if (branding?.typography) {
            expect(typeof branding.typography).toBe("object");
          }

          // Spacing should be present
          if (branding?.spacing) {
            expect(typeof branding.spacing).toBe("object");
          }

          // Components should be present
          if (branding?.components) {
            expect(typeof branding.components).toBe("object");
          }

          // Color scheme should be 'light' or 'dark' if present
          if (branding?.colorScheme) {
            expect(["light", "dark"]).toContain(branding.colorScheme);
          }

          // Logo should be a valid URL if present
          if (branding?.logo) {
            expect(typeof branding.logo).toBe("string");
            expect(branding.logo.length).toBeGreaterThan(0);
          }
        },
        scrapeTimeout,
      );
    });
  });
});
