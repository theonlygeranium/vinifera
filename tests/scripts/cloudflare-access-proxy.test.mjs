import { describe, expect, it } from "vitest";

import { rewriteOctopusOidcDiscovery } from "../../.github/scripts/cloudflare-access-proxy.mjs";

describe("Cloudflare Access Octopus proxy", () => {
  it("rewrites Octopus OIDC discovery token endpoints back through the local proxy", () => {
    const body = Buffer.from(
      JSON.stringify({
        issuer: "https://octopus.schubert.life",
        token_endpoint: "http://localhost:8080/token/v1",
      }),
    );

    const rewritten = rewriteOctopusOidcDiscovery({
      body,
      proxyBase: new URL("http://127.0.0.1:41809"),
      requestUrl: "/.well-known/openid-configuration",
      responseHeaders: new Headers({ "content-type": "application/json" }),
    });

    expect(JSON.parse(rewritten.toString("utf8"))).toMatchObject({
      issuer: "https://octopus.schubert.life",
      token_endpoint: "http://127.0.0.1:41809/token/v1",
    });
  });

  it("leaves non-discovery responses unchanged", () => {
    const body = Buffer.from(JSON.stringify({ links: { api: "/api" } }));

    const rewritten = rewriteOctopusOidcDiscovery({
      body,
      proxyBase: new URL("http://127.0.0.1:41809"),
      requestUrl: "/api",
      responseHeaders: new Headers({ "content-type": "application/json" }),
    });

    expect(rewritten).toEqual(body);
  });
});
