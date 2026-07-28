import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { describe, expect, it } from "vitest";

const devScriptUrl = new URL("../../scripts/dev.sh", import.meta.url);
const runtimeFilesUrl = new URL(
  "../../scripts/dev-runtime-files.sh",
  import.meta.url,
);
const serviceReadinessUrl = new URL(
  "../../scripts/dev-service-readiness.sh",
  import.meta.url,
);
const localExampleUrl = new URL("../../.env.local.example", import.meta.url);
const execFileAsync = promisify(execFile);

describe("local development privilege boundaries", () => {
  it("keeps server-only values out of build and Vite environments", async () => {
    const source = await readFile(devScriptUrl, "utf8");
    const serverOnlyNames = [
      "MEMBER_BRAND_CONTEXT_SECRET",
      "RATE_LIMIT_PEPPER",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_URL",
    ];

    for (const name of serverOnlyNames) {
      expect(source).not.toMatch(new RegExp(`export ${name}(?:=|\\n)`));
    }

    const buildCommand = source.match(
      /echo "\[4\/5\][\s\S]*?npm run build/,
    )?.[0];
    const frontendBoundary = source.indexOf("worker_pid=$!");
    expect(frontendBoundary).toBeGreaterThanOrEqual(0);
    const viteCommand = source.slice(frontendBoundary).match(
      /env \\\n(?:[\s\S]*?)npm run dev:frontend/,
    )?.[0];
    expect(buildCommand).toBeTruthy();
    expect(viteCommand).toBeTruthy();
    for (const name of serverOnlyNames) {
      expect(buildCommand).toContain(`-u ${name}`);
      expect(viteCommand).toContain(`-u ${name}`);
    }
  });

  it("keeps the tracked Vite example credential-free", async () => {
    const source = await readFile(localExampleUrl, "utf8");
    expect(source).toContain(
      "VITE_API_BASE_URL=http://127.0.0.1:8788",
    );
    expect(source).not.toMatch(
      /(?:SERVICE_ROLE|SECRET_KEY|PASSWORD|TOKEN|DSN|PEPPER)\s*=/u,
    );
  });

  it("requires both child services before smoke and final readiness", async () => {
    const source = await readFile(devScriptUrl, "utf8");
    const readinessIndex = source.indexOf(
      "wait_for_vinifera_services",
    );
    const smokeIndex = source.indexOf("npm run dev:smoke");
    const initialWorkerHealthIndex = source.indexOf(
      "http://127.0.0.1:8788/api/health",
      readinessIndex,
    );
    const initialFrontendHealthIndex = source.indexOf(
      "http://127.0.0.1:5173/app/",
      readinessIndex,
    );
    const postSmokeWorkerProbeIndex = source.indexOf(
      'vinifera_http_ready "http://127.0.0.1:8788/api/health"',
      smokeIndex,
    );
    const postSmokeFrontendProbeIndex = source.indexOf(
      'vinifera_http_ready "http://127.0.0.1:5173/app/"',
      smokeIndex,
    );
    const workerGuardIndex = source.indexOf(
      'kill -0 "$worker_pid"',
      smokeIndex,
    );
    const frontendGuardIndex = source.indexOf(
      'kill -0 "$frontend_pid"',
      smokeIndex,
    );
    const readyIndex = source.indexOf(
      "Vinifera local development is ready:",
      smokeIndex,
    );

    expect(readinessIndex).toBeGreaterThanOrEqual(0);
    expect(initialWorkerHealthIndex).toBeGreaterThan(readinessIndex);
    expect(initialFrontendHealthIndex).toBeGreaterThan(initialWorkerHealthIndex);
    expect(smokeIndex).toBeGreaterThanOrEqual(0);
    expect(smokeIndex).toBeGreaterThan(initialFrontendHealthIndex);
    expect(workerGuardIndex).toBeGreaterThan(smokeIndex);
    expect(frontendGuardIndex).toBeGreaterThan(workerGuardIndex);
    expect(postSmokeWorkerProbeIndex).toBeGreaterThan(frontendGuardIndex);
    expect(postSmokeFrontendProbeIndex).toBeGreaterThan(
      postSmokeWorkerProbeIndex,
    );
    expect(readyIndex).toBeGreaterThan(postSmokeFrontendProbeIndex);
  });

  it("does not combine transient service successes across iterations", async () => {
    await expect(
      execFileAsync(
        "bash",
        [
          "-c",
          [
            'source "$1"',
            "worker_calls=0",
            "frontend_calls=0",
            "vinifera_http_ready() {",
            '  if [[ "$1" == "worker" ]]; then',
            "    worker_calls=$((worker_calls + 1))",
            '    [[ "$worker_calls" -eq 1 ]]',
            "    return",
            "  fi",
            "  frontend_calls=$((frontend_calls + 1))",
            '  [[ "$frontend_calls" -gt 1 ]]',
            "}",
            'wait_for_vinifera_services "$$" "$$" worker frontend 2',
          ].join("\n"),
          "vinifera-readiness-test",
          serviceReadinessUrl.pathname,
        ],
      ),
    ).rejects.toMatchObject({ code: 1 });
  });

  it("bounds a stalled HTTP probe", async () => {
    const sockets = new Set();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Expected a TCP server address.");
      }
      const startedAt = Date.now();
      await expect(
        execFileAsync(
          "bash",
          [
            "-c",
            'source "$1"; vinifera_http_ready "$2"',
            "vinifera-readiness-test",
            serviceReadinessUrl.pathname,
            `http://127.0.0.1:${address.port}/`,
          ],
          { timeout: 5_000 },
        ),
      ).rejects.toMatchObject({ code: 28 });
      expect(Date.now() - startedAt).toBeLessThan(4_000);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  it("uses an invocation-owned env file without touching a user sentinel", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vinifera-dev-files-"));
    try {
      const sentinel = join(directory, ".dev.vars.local");
      await writeFile(sentinel, "PRESERVE_ME=true\n", { mode: 0o600 });

      const { stdout } = await execFileAsync(
        "bash",
        [
          "-c",
          [
            'source "$1"',
            'runtime_file="$(create_vinifera_runtime_file worker-env)"',
            'chmod 600 "$runtime_file"',
            'printf "%s\\n" "$runtime_file"',
            'remove_vinifera_runtime_file "$runtime_file"',
          ].join("\n"),
          "vinifera-runtime-test",
          runtimeFilesUrl.pathname,
        ],
        {
          env: {
            ...process.env,
            TMPDIR: directory,
          },
        },
      );

      const runtimeFile = stdout.trim();
      expect(runtimeFile).toMatch(/vinifera-worker-env\.[A-Za-z0-9]+$/u);
      await expect(stat(runtimeFile)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(sentinel, "utf8")).toBe("PRESERVE_ME=true\n");
      expect((await stat(sentinel)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
