import { env } from "cloudflare:workers";
import { createServer } from "node:http";
import { httpServerHandler } from "cloudflare:node";
import { createApp } from "./app";
import { withSecurityHeaders } from "./lib/security";
import { runAnalyticsSchedule } from "./services/analytics";
import { runCoreClubSchedule } from "./services/core-club";
import { reconcileSubscriptionAccess } from "./services/production-foundation";
import { runRetentionSchedule } from "./services/retention";
import {
  runIntegrationSchedule,
  runMobilePushSchedule,
} from "./services/integrations";
import type { WorkerEnv } from "./types";

const API_PORT = 8788;
const app = createApp({
  getEnv: () => env as WorkerEnv,
});
const server = createServer(app);
server.listen(API_PORT);
const expressHandler = httpServerHandler({ port: API_PORT });
const expressFetch = expressHandler.fetch as
  | ((
      request: Request,
      workerEnv: WorkerEnv,
      context: ExecutionContext,
    ) => Promise<Response> | Response)
  | undefined;

function isApplicationRoute(pathname: string): boolean {
  return (
    pathname === "/app" ||
    pathname.startsWith("/app/") ||
    pathname === "/portal" ||
    pathname.startsWith("/portal/")
  );
}

async function fetchStaticAsset(
  request: Request,
  assets: Fetcher,
): Promise<Response> {
  const retryRequest: Request | null =
    request.method === "GET" || request.method === "HEAD"
      ? new Request(request.url, request)
      : null;
  const response = await assets.fetch(request);
  if (
    retryRequest &&
    [500, 502, 503, 504].includes(response.status)
  ) {
    return assets.fetch(retryRequest);
  }
  return response;
}

async function serveApplicationShell(
  request: Request,
  workerEnv: WorkerEnv,
): Promise<Response> {
  if (!workerEnv.ASSETS) {
    return new Response("Static asset binding is not configured.", { status: 503 });
  }
  const shellUrl = new URL("/app.html", request.url);
  const shellRequest = new Request(shellUrl, request);
  const response = await fetchStaticAsset(shellRequest, workerEnv.ASSETS);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(response.body, { headers, status: response.status });
}

async function serveStaticAsset(
  request: Request,
  workerEnv: WorkerEnv,
): Promise<Response> {
  if (!workerEnv.ASSETS) {
    return new Response("Static asset binding is not configured.", { status: 503 });
  }
  const requestUrl = new URL(request.url);
  if (requestUrl.pathname === "/") {
    requestUrl.pathname = "/index.html";
    return fetchStaticAsset(
      new Request(requestUrl, request),
      workerEnv.ASSETS,
    );
  }
  return fetchStaticAsset(request, workerEnv.ASSETS);
}

export default {
  async fetch(
    request: Request,
    workerEnv: WorkerEnv,
    context: ExecutionContext,
  ): Promise<Response> {
    const { pathname } = new URL(request.url);
    let response: Response;

    if (
      pathname.startsWith("/api/") ||
      pathname === "/.well-known/apple-app-site-association" ||
      pathname === "/.well-known/assetlinks.json"
    ) {
      if (!expressFetch) {
        response = new Response("API handler is unavailable.", { status: 503 });
      } else {
        response = await expressFetch(request, workerEnv, context);
      }
    } else if (isApplicationRoute(pathname)) {
      response = await serveApplicationShell(request, workerEnv);
    } else {
      response = await serveStaticAsset(request, workerEnv);
    }

    return withSecurityHeaders(response);
  },
  async scheduled(
    _controller: ScheduledController,
    workerEnv: WorkerEnv,
    context: ExecutionContext,
  ): Promise<void> {
    context.waitUntil(
      Promise.allSettled([
        runAnalyticsSchedule(workerEnv),
        reconcileSubscriptionAccess(workerEnv),
        runCoreClubSchedule(workerEnv),
        runIntegrationSchedule(workerEnv),
        runMobilePushSchedule(workerEnv),
        runRetentionSchedule(workerEnv),
      ]).then((results) => {
        const failedJobs = results.flatMap((result, index) =>
          result.status === "rejected"
            ? [
                [
                  "analytics",
                  "subscription reconciliation",
                  "core club",
                  "integrations",
                  "mobile push",
                  "retention",
                ][index] ?? `job ${index + 1}`,
              ]
            : [],
        );
        if (failedJobs.length) {
          throw new Error(
            `Scheduled work failed after all jobs ran: ${failedJobs.join(", ")}.`,
          );
        }
      }),
    );
  },
};
