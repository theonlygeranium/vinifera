import type { Request } from "express";
import type { WorkerEnv } from "../types";

function trustsCloudflareConnectingIp(env: WorkerEnv): boolean {
  return env.APP_ENV === "staging" || env.APP_ENV === "production";
}

/**
 * Cloudflare overwrites CF-Connecting-IP at the edge, but the same header is
 * caller-controlled when Express runs directly in local development or tests.
 */
export function getClientAddress(
  request: Request,
  env: WorkerEnv,
): string {
  if (trustsCloudflareConnectingIp(env)) {
    const connectingIp = request.get("cf-connecting-ip")?.trim();
    if (connectingIp) return connectingIp;
  }

  return request.socket.remoteAddress || "unknown";
}
