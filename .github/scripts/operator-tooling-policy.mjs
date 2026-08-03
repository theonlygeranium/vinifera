import { execFileSync } from "node:child_process";

const SCRIPT_KEY_PATTERN = /^(ops:|qa:|test(?::|$))/;
const SCRIPT_COMMAND_PATTERN = /^(node|npx vitest|vitest|npm run (ops:|qa:|test(?::|$)))/;

function readJsonAt(ref, path, cwd = process.cwd()) {
  return JSON.parse(
    execFileSync("git", ["show", `${ref}:${path}`], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}

function stableWithoutScripts(pkg) {
  const clone = structuredClone(pkg);
  delete clone.scripts;
  return clone;
}

function changedScriptEntries(baseScripts = {}, headScripts = {}) {
  const keys = new Set([...Object.keys(baseScripts), ...Object.keys(headScripts)]);
  return [...keys]
    .filter((key) => baseScripts[key] !== headScripts[key])
    .map((key) => ({ key, value: headScripts[key] }));
}

export function validateOperatorPackageJson({
  baseSha,
  headSha,
  cwd = process.cwd(),
} = {}) {
  if (!/^[0-9a-f]{40}$/i.test(baseSha || "") || !/^[0-9a-f]{40}$/i.test(headSha || "")) {
    throw new Error("Operator tooling package validation requires exact base and head SHAs.");
  }
  const basePackage = readJsonAt(baseSha, "package.json", cwd);
  const headPackage = readJsonAt(headSha, "package.json", cwd);

  if (
    JSON.stringify(stableWithoutScripts(basePackage)) !==
    JSON.stringify(stableWithoutScripts(headPackage))
  ) {
    throw new Error(
      "Operator tooling fast lane permits package.json script changes only; dependencies and package metadata require full validation.",
    );
  }

  const changedScripts = changedScriptEntries(basePackage.scripts, headPackage.scripts);
  if (changedScripts.length === 0) {
    return { changedScripts: [] };
  }
  for (const { key, value } of changedScripts) {
    if (!SCRIPT_KEY_PATTERN.test(key)) {
      throw new Error(`Operator tooling fast lane cannot change npm script "${key}".`);
    }
    if (typeof value !== "string" || !SCRIPT_COMMAND_PATTERN.test(value)) {
      throw new Error(`Operator tooling fast lane rejected npm script "${key}" command.`);
    }
  }
  return { changedScripts: changedScripts.map(({ key }) => key) };
}
