import http from "node:http";
import { pathToFileURL } from "node:url";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function targetUrlFor(requestUrl, targetBase) {
  const parsed = new URL(requestUrl, targetBase);
  if (parsed.origin !== targetBase.origin) {
    return new URL(`${parsed.pathname}${parsed.search}`, targetBase);
  }
  return parsed;
}

function requestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function outgoingHeaders(request, targetBase) {
  const headers = { ...request.headers };
  delete headers.host;
  delete headers.connection;
  delete headers["content-length"];
  headers.host = targetBase.host;
  headers["cf-access-client-id"] = requiredEnv("CF_ACCESS_CLIENT_ID");
  headers["cf-access-client-secret"] = requiredEnv("CF_ACCESS_CLIENT_SECRET");
  return headers;
}

export function createCloudflareAccessProxy({
  fetchImpl = fetch,
  targetBase = new URL(requiredEnv("OCTOPUS_TARGET_URL")),
} = {}) {
  if (targetBase.protocol !== "https:") {
    throw new Error("OCTOPUS_TARGET_URL must use HTTPS");
  }

  return http.createServer(async (request, response) => {
    try {
      const targetUrl = targetUrlFor(request.url ?? "/", targetBase);
      const body = await requestBody(request);
      const upstream = await fetchImpl(targetUrl, {
        method: request.method,
        headers: outgoingHeaders(request, targetBase),
        body:
          request.method === "GET" || request.method === "HEAD" ? undefined : body,
        redirect: "manual",
      });
      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.delete("content-encoding");
      responseHeaders.delete("content-length");
      response.writeHead(
        upstream.status,
        Object.fromEntries(responseHeaders.entries()),
      );
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
}

async function main() {
  const port = Number.parseInt(process.env.CF_ACCESS_PROXY_PORT ?? "41809", 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("CF_ACCESS_PROXY_PORT must be a valid TCP port");
  }
  const server = createCloudflareAccessProxy();
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  console.log(`Cloudflare Access proxy listening on 127.0.0.1:${port}`);

  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
