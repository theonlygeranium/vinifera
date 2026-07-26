import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, postJson } from "../../src/client/api/client";

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function commandKey(call: unknown[]) {
  const options = call[1] as RequestInit;
  return new Headers(options.headers).get("Idempotency-Key");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Phase 2 client command idempotency", () => {
  it("retains the generated command UUID across a network retry and rotates it after success", async () => {
    const firstKey = "91000000-0000-4000-8000-000000000001";
    const nextKey = "91000000-0000-4000-8000-000000000002";
    const randomUUID = vi
      .fn()
      .mockReturnValueOnce(firstKey)
      .mockReturnValueOnce(nextKey);
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(jsonResponse(201, { data: { id: "member-1" } }))
      .mockResolvedValueOnce(jsonResponse(201, { data: { id: "member-2" } }));
    vi.stubGlobal("crypto", {
      randomUUID,
      subtle: globalThis.crypto.subtle,
    });
    vi.stubGlobal("fetch", fetch);
    const payload = {
      email: "retry-network@example.test",
      firstName: "Retry",
      lastName: "Network",
    };

    await expect(postJson("/api/members", payload)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      status: 0,
    } satisfies Partial<ApiError>);
    await postJson("/api/members", payload);
    await postJson("/api/members", payload);

    expect(commandKey(fetch.mock.calls[0]!)).toBe(firstKey);
    expect(commandKey(fetch.mock.calls[1]!)).toBe(firstKey);
    expect(commandKey(fetch.mock.calls[2]!)).toBe(nextKey);
  });

  it("retains the generated command UUID after a retryable server error", async () => {
    const commandId = "91000000-0000-4000-8000-000000000003";
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(503, {
          error: {
            code: "UPSTREAM_ERROR",
            message: "Temporarily unavailable.",
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { data: { updated: 2 } }));
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn().mockReturnValue(commandId),
      subtle: globalThis.crypto.subtle,
    });
    vi.stubGlobal("fetch", fetch);
    const payload = { action: "pause", scope: "all" };

    await expect(postJson("/api/members/batch", payload)).rejects.toMatchObject({
      status: 503,
    } satisfies Partial<ApiError>);
    await postJson("/api/members/batch", payload);

    expect(commandKey(fetch.mock.calls[0]!)).toBe(commandId);
    expect(commandKey(fetch.mock.calls[1]!)).toBe(commandId);
  });

  it.each([408, 425, 429])(
    "retains the generated command UUID after retryable HTTP %s",
    async (status) => {
      const commandId = "91000000-0000-4000-8000-000000000005";
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(status, {
            error: {
              code: "RETRY_LATER",
              message: "Retry this command later.",
            },
          }),
        )
        .mockResolvedValueOnce(jsonResponse(200, { data: { updated: 2 } }));
      vi.stubGlobal("crypto", {
        randomUUID: vi.fn().mockReturnValue(commandId),
        subtle: globalThis.crypto.subtle,
      });
      vi.stubGlobal("fetch", fetch);
      const payload = { action: "pause", scope: "all" };

      await expect(postJson("/api/members/batch", payload)).rejects.toMatchObject(
        { status },
      );
      await postJson("/api/members/batch", payload);

      expect(commandKey(fetch.mock.calls[0]!)).toBe(commandId);
      expect(commandKey(fetch.mock.calls[1]!)).toBe(commandId);
    },
  );

  it("persists only a hashed command fingerprint across a module reload", async () => {
    const commandId = "91000000-0000-4000-8000-000000000004";
    const stored = new Map<string, string>();
    const sessionStorage = {
      getItem: vi.fn((key: string) => stored.get(key) ?? null),
      removeItem: vi.fn((key: string) => {
        stored.delete(key);
      }),
      setItem: vi.fn((key: string, value: string) => {
        stored.set(key, value);
      }),
    };
    vi.stubGlobal("window", { sessionStorage });
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn().mockReturnValue(commandId),
      subtle: globalThis.crypto.subtle,
    });
    const firstFetch = vi.fn().mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", firstFetch);
    const payload = {
      email: "reload-private@example.test",
      firstName: "Reload",
      lastName: "Private",
    };

    vi.resetModules();
    const firstClient = await import("../../src/client/api/client");
    await expect(
      firstClient.postJson("/api/members", payload),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });

    expect(stored.size).toBe(1);
    const [storageKey, storageValue] = [...stored.entries()][0]!;
    expect(storageKey).toMatch(
      /^vinifera[.]pending-command[.][a-f0-9]{64}$/,
    );
    expect(storageKey).not.toContain(payload.email);
    expect(storageKey).not.toContain(payload.firstName);
    expect(storageValue).toBe(commandId);

    const secondFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { data: { id: "member-reload" } }));
    vi.stubGlobal("fetch", secondFetch);
    vi.resetModules();
    const reloadedClient = await import("../../src/client/api/client");
    await reloadedClient.postJson("/api/members", payload);

    expect(commandKey(secondFetch.mock.calls[0]!)).toBe(commandId);
    expect(stored.size).toBe(0);
  });
});
