import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  normalizeApiBase,
  resolveFormValues,
  runRunbook,
} from "../../.github/scripts/octopus-runbook.mjs";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Octopus runbook bridge", () => {
  it("normalizes an HTTPS server URL to the API root", () => {
    expect(normalizeApiBase("https://octopus.example.test/")).toBe(
      "https://octopus.example.test/api",
    );
    expect(normalizeApiBase("https://octopus.example.test/api/")).toBe(
      "https://octopus.example.test/api",
    );
  });

  it("rejects an insecure server URL", () => {
    expect(() => normalizeApiBase("http://octopus.example.test")).toThrow(
      "must use HTTPS",
    );
  });

  it("maps prompted names to Octopus form element IDs and fails closed", () => {
    const preview = {
      Form: {
        Elements: [
          { Name: "Variables-1", Control: { Name: "PRBranch", Required: true } },
          { Name: "Variables-2", Control: { Name: "PRNumber", Required: true } },
        ],
      },
    };
    expect(
      resolveFormValues(preview, { PRBranch: "fix/example", PRNumber: "44" }),
    ).toEqual({
      "Variables-1": "fix/example",
      "Variables-2": "44",
    });
    expect(() =>
      resolveFormValues(preview, { PRBranch: "fix/example" }),
    ).toThrow("Missing required");
  });

  it("refuses to submit a PAT through a non-sensitive Octopus prompt", () => {
    const preview = {
      Form: {
        Elements: [
          {
            Name: "Variables-1",
            Control: { Name: "GitHubPAT", Required: true, Type: "Text" },
          },
        ],
      },
    };

    expect(() =>
      resolveFormValues(preview, { GitHubPAT: "secret-pat" }),
    ).toThrow("GitHubPAT prompted variable must be marked sensitive");
  });

  it("creates a run with prompted values and waits for task success", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("/spaces?")) {
        return jsonResponse({ Items: [{ Id: "Spaces-1", Name: "Default" }] });
      }
      if (String(url).includes("/environments?")) {
        return jsonResponse({
          Items: [{ Id: "Environments-1", Name: "Development" }],
        });
      }
      if (String(url).includes("/projects?")) {
        return jsonResponse({ Items: [{ Id: "Projects-1", Name: "Vinifera" }] });
      }
      if (String(url).includes("/projects/Projects-1/runbooks?")) {
        return jsonResponse({
          Items: [
            {
              Id: "Runbooks-1",
              Name: "PR Quality Gates",
              PublishedRunbookSnapshotId: "RunbookSnapshots-1",
            },
          ],
        });
      }
      if (String(url).includes("/preview/Environments-1")) {
        return jsonResponse({
          Form: {
            Elements: [
              { Name: "V-1", Control: { Name: "PRBranch", Required: true } },
              { Name: "V-2", Control: { Name: "PRNumber", Required: true } },
              {
                Name: "V-3",
                Control: {
                  Name: "GitHubPAT",
                  Required: true,
                  Type: "Sensitive",
                },
              },
            ],
          },
        });
      }
      if (String(url).endsWith("/Spaces-1/runbookRuns")) {
        return jsonResponse({ Id: "RunbookRuns-1", TaskId: "ServerTasks-1" });
      }
      if (String(url).endsWith("/tasks/ServerTasks-1")) {
        return jsonResponse({ State: "Success" });
      }
      return jsonResponse({}, 404);
    });
    const log = vi.fn();

    await expect(
      runRunbook({
        runbookName: "PR Quality Gates",
        environment: {
          CF_ACCESS_CLIENT_ID: "access-client-id",
          CF_ACCESS_CLIENT_SECRET: "access-client-secret",
          GH_PAT_FOR_OCTOPUS: "secret-pat",
          OCTOPUS_API_KEY: "secret-api-key",
          OCTOPUS_URL: "https://octopus.example.test",
          PR_BRANCH: "fix/example",
          PR_NUMBER: "44",
        },
        fetchImpl,
        sleep: vi.fn(),
        log,
      }),
    ).resolves.toEqual({
      runId: "RunbookRuns-1",
      taskId: "ServerTasks-1",
      state: "Success",
    });

    const post = calls.find(({ url }) =>
      url.endsWith("/Spaces-1/runbookRuns"),
    );
    const runRequest = JSON.parse(post.options.body);
    expect(runRequest.RunbookSnapshotId).toBe("RunbookSnapshots-1");
    expect(runRequest).not.toHaveProperty("RunbookSnapShotId");
    expect(runRequest.FormValues).toEqual({
      "V-1": "fix/example",
      "V-2": "44",
      "V-3": "secret-pat",
    });
    expect(
      calls.every(
        ({ options }) =>
          options.headers["CF-Access-Client-Id"] === "access-client-id" &&
          options.headers["CF-Access-Client-Secret"] === "access-client-secret" &&
          options.headers["X-Octopus-ApiKey"] === "secret-api-key",
      ),
    ).toBe(true);
    expect(log).toHaveBeenCalledWith(
      "Octopus runbook passed: PR Quality Gates",
    );
  });

  it("preserves the timeout error when task cancellation fails", async () => {
    const fetchImpl = vi.fn(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/spaces?")) {
        return jsonResponse({ Items: [{ Id: "Spaces-1", Name: "Default" }] });
      }
      if (requestUrl.includes("/environments?")) {
        return jsonResponse({
          Items: [{ Id: "Environments-1", Name: "Development" }],
        });
      }
      if (requestUrl.includes("/projects?")) {
        return jsonResponse({ Items: [{ Id: "Projects-1", Name: "Vinifera" }] });
      }
      if (requestUrl.includes("/projects/Projects-1/runbooks?")) {
        return jsonResponse({
          Items: [
            {
              Id: "Runbooks-1",
              Name: "PR Quality Gates",
              PublishedRunbookSnapshotId: "RunbookSnapshots-1",
            },
          ],
        });
      }
      if (requestUrl.includes("/preview/Environments-1")) {
        return jsonResponse({
          Form: {
            Elements: [
              { Name: "V-1", Control: { Name: "PRBranch", Required: true } },
              { Name: "V-2", Control: { Name: "PRNumber", Required: true } },
              {
                Name: "V-3",
                Control: {
                  Name: "GitHubPAT",
                  Required: true,
                  Sensitive: true,
                },
              },
            ],
          },
        });
      }
      if (requestUrl.endsWith("/Spaces-1/runbookRuns")) {
        return jsonResponse({ Id: "RunbookRuns-1", TaskId: "ServerTasks-1" });
      }
      if (requestUrl.endsWith("/tasks/ServerTasks-1/cancel")) {
        return jsonResponse({}, 500);
      }
      return jsonResponse({}, 404);
    });
    const log = vi.fn();

    await expect(
      runRunbook({
        runbookName: "PR Quality Gates",
        environment: {
          CF_ACCESS_CLIENT_ID: "access-client-id",
          CF_ACCESS_CLIENT_SECRET: "access-client-secret",
          GH_PAT_FOR_OCTOPUS: "secret-pat",
          OCTOPUS_API_KEY: "secret-api-key",
          OCTOPUS_URL: "https://octopus.example.test",
          PR_BRANCH: "fix/example",
          PR_NUMBER: "44",
        },
        fetchImpl,
        timeoutMs: -1,
        log,
      }),
    ).rejects.toThrow("Octopus runbook timed out after -1ms");
    expect(log).toHaveBeenCalledWith(
      "Failed to cancel Octopus task ServerTasks-1: Octopus API request failed with HTTP 500",
    );
  });
});

describe("Octopus workflow trust boundary", () => {
  it("executes only the trusted default-branch bridge with secrets", () => {
    const workflow = readFileSync(
      new URL(
        "../../.github/workflows/octopus-pr-quality-gates.yml",
        import.meta.url,
      ),
      "utf8",
    );

    expect(workflow).toContain("pull_request_target:");
    expect(workflow).not.toContain("\n  pull_request:");
    expect(workflow).toContain(
      "ref: ${{ github.event.repository.default_branch }}",
    );
    expect(workflow.match(/persist-credentials: false/g)).toHaveLength(2);
    expect(workflow).not.toContain("github.event.pull_request.head.sha");
    expect(workflow).not.toContain("github.head_ref");
    expect(workflow).toContain(
      "PR_BRANCH: ${{ github.event.pull_request.head.ref }}",
    );
    expect(workflow).not.toMatch(
      /uses:\s+actions\/checkout@(main|master|v[0-9]+)(\s|$)/,
    );
  });
});
