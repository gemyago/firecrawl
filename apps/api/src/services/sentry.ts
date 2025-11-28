// Import with `import * as Sentry from "@sentry/node"` if you are using ESM
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import { logger } from "../lib/logger";

if (process.env.SENTRY_DSN) {
  logger.info("Setting up Sentry...");

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: integrations => [...integrations, nodeProfilingIntegration()],
    tracesSampleRate: 0,
    sampleRate: 0.1,
    serverName: process.env.NUQ_POD_NAME,
    environment: process.env.SENTRY_ENVIRONMENT ?? "production",
    skipOpenTelemetrySetup: true,
    beforeSend(event, hint) {
      const error = hint.originalException;

      // Defense in depth: Filter TransportableErrors and common network errors
      // TransportableErrors are flow control - workers filter these, but this catches any that slip through
      // Critical issues like NoEnginesLeftError are captured explicitly at their source
      if (error && typeof error === "object") {
        const errorCode = "code" in error ? String(error.code) : "";

        // Filter all TransportableError codes (they're flow control, not bugs)
        const transportableErrorCodes = [
          "SCRAPE_ALL_ENGINES_FAILED", // Captured explicitly when thrown
          "SCRAPE_DNS_RESOLUTION_ERROR",
          "SCRAPE_SITE_ERROR",
          "SCRAPE_SSL_ERROR",
          "SCRAPE_PROXY_SELECTION_ERROR",
          "SCRAPE_ZDR_VIOLATION_ERROR",
          "SCRAPE_UNSUPPORTED_FILE_ERROR",
          "SCRAPE_PDF_ANTIBOT_ERROR",
          "SCRAPE_ACTION_ERROR",
          "SCRAPE_PDF_INSUFFICIENT_TIME_ERROR",
          "SCRAPE_PDF_PREFETCH_FAILED",
          "SCRAPE_DOCUMENT_ANTIBOT_ERROR",
          "SCRAPE_DOCUMENT_PREFETCH_FAILED",
          "SCRAPE_TIMEOUT",
          "MAP_TIMEOUT",
          "SCRAPE_UNKNOWN_ERROR",
          "SCRAPE_RACED_REDIRECT_ERROR",
          "SCRAPE_SITEMAP_ERROR", // Sitemap parse/load errors
          "CRAWL_DENIAL", // URLs blocked by crawl rules (robots.txt, etc.)
        ];

        if (transportableErrorCodes.includes(errorCode)) {
          return null;
        }

        // Filter raw network errors that might not be wrapped in TransportableError
        const networkErrorCodes = [
          "ENOTFOUND",
          "EAI_AGAIN",
          "ECONNREFUSED",
          "ETIMEDOUT",
          "EHOSTUNREACH",
          "ENETUNREACH",
          "ECONNRESET",
          "ECONNABORTED",
          "EPIPE",
        ];

        if (networkErrorCodes.includes(errorCode)) {
          return null;
        }

        // Filter Zod validation errors for invalid URLs (user input errors)
        if (error.constructor?.name === "ZodError") {
          const errorMessage = "message" in error ? String(error.message) : "";
          if (
            errorMessage.includes("Invalid url") ||
            errorMessage.includes("Invalid URL")
          ) {
            return null;
          }
        }
      }

      return event;
    },
  });
}

/**
 * Set the service type tag for this Sentry instance
 * This helps distinguish between API server and worker errors in Sentry
 */
export function setSentryServiceTag(serviceType: string) {
  if (process.env.SENTRY_DSN) {
    Sentry.setTag("service_type", serviceType);
  }
}
