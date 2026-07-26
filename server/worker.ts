import { env } from "cloudflare:workers";
import { createServer } from "node:http";
import { httpServerHandler } from "cloudflare:node";
import { createApp } from "./app";
import { withSecurityHeaders } from "./lib/security";
import { reconcileSubscriptionAccess } from "./services/production-foundation";
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

async function serveApplicationShell(
  request: Request,
  workerEnv: WorkerEnv,
): Promise<Response> {
  if (!workerEnv.ASSETS) {
    return new Response("Static asset binding is not configured.", { status: 503 });
  }
  const shellUrl = new URL("/app.html", request.url);
  const shellRequest = new Request(shellUrl, request);
  const response = await workerEnv.ASSETS.fetch(shellRequest);
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
    return workerEnv.ASSETS.fetch(new Request(requestUrl, request));
  }
  return workerEnv.ASSETS.fetch(request);
}

export default {
  async fetch(
    request: Request,
    workerEnv: WorkerEnv,
    context: ExecutionContext,
  ): Promise<Response> {
    const { pathname } = new URL(request.url);
    let response: Response;

    if (pathname.startsWith("/api/")) {
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
    context.waitUntil(reconcileSubscriptionAccess(workerEnv));
  },
};
