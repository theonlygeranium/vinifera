import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  classifyDeliveryChange,
  evaluateFastAggregate,
  evaluateFullAggregate,
  isHighRiskPath,
  parseNameStatusZ,
  selectFocusedTests,
} from "./delivery-policy.mjs";

const record = (status, ...paths) => ({ status, paths });

test("routine frontend changes select the fast routine lane", () => {
  const result = classifyDeliveryChange([
    record("M", "src/client/App.tsx"),
    record("M", "tests/client/loading-screen.test.tsx"),
  ]);
  assert.equal(result.classificationSucceeded, true);
  assert.equal(result.lane, "routine");
  assert.equal(result.mobileRequired, false);
});

test("documentation-only changes select the documentation lane", () => {
  assert.equal(
    classifyDeliveryChange([
      record("M", "README.md"),
      record("A", "docs/runbooks/fast-ci.md"),
    ]).lane,
    "docs",
  );
});

test("minimum mandated security and delivery paths are high-risk", () => {
  const paths = [
    "server/routes/auth.ts",
    "server/lib/authorization.ts",
    "server/services/stripe.ts",
    "server/services/members.ts",
    "supabase/migrations/999.sql",
    ".github/workflows/ci.yml",
    ".octopus/config.yml",
    "scripts/credential-envelope-rotation.mjs",
    "scripts/production-release.mjs",
    "wrangler.jsonc",
    "package-lock.json",
    ".nvmrc",
    "tests/e2e/smoke.spec.ts",
  ];
  for (const path of paths) {
    assert.equal(isHighRiskPath(path), true, path);
    assert.equal(classifyDeliveryChange([record("M", path)]).lane, "high-risk");
  }
});

test("unknown paths and deletions fail closed to high-risk", () => {
  assert.deepEqual(
    classifyDeliveryChange([record("M", "unknown/new-format.bin")]).lane,
    "high-risk",
  );
  assert.equal(
    classifyDeliveryChange([record("D", "src/client/Old.tsx")]).lane,
    "high-risk",
  );
});

test("malformed, unsupported, unsafe, and empty diffs are invalid", () => {
  for (const records of [
    [],
    null,
    [{}],
    [record("U", "README.md")],
    [record("M", "../README.md")],
    [record("C100", "docs/a.md", "docs/b.md")],
  ]) {
    const result = classifyDeliveryChange(records);
    assert.equal(result.classificationSucceeded, false);
    assert.equal(result.lane, "invalid");
  }
});

test("NUL parser preserves rename paths and rejects truncation", () => {
  assert.deepEqual(
    parseNameStatusZ(Buffer.from("M\0README.md\0R100\0docs/a.md\0docs/b.md\0")),
    [record("M", "README.md"), record("R100", "docs/a.md", "docs/b.md")],
  );
  assert.throws(() => parseNameStatusZ(Buffer.from("R100\0docs/a.md\0")));
});

test("mobile selection covers native, Capacitor, shared mobile web, and dependencies", () => {
  for (const path of [
    "android/app/build.gradle",
    "ios/App/Info.plist",
    "mobile/app-identity.json",
    "src/client/mobile/session.ts",
    "capacitor.config.json",
    "package-lock.json",
  ]) {
    assert.equal(
      classifyDeliveryChange([record("M", path)]).mobileRequired,
      true,
      path,
    );
  }
});

test("focused tests reflect the changed domain", () => {
  const tests = selectFocusedTests(
    ["src/client/App.tsx", "server/routes/auth.ts", "scripts/build.mjs"],
    "high-risk",
  );
  assert.ok(tests.includes("tests/client"));
  assert.ok(tests.includes("tests/server"));
  assert.ok(tests.includes("tests/scripts"));
});

test("fast aggregate accepts only the selected successful lane", () => {
  assert.equal(
    evaluateFastAggregate({
      classificationSucceeded: true,
      lane: "routine",
      classifyResult: "success",
      docsResult: "skipped",
      checksResult: "success",
      smokeResult: "success",
    }).passed,
    true,
  );
  assert.equal(
    evaluateFastAggregate({
      classificationSucceeded: true,
      lane: "docs",
      classifyResult: "success",
      docsResult: "skipped",
      checksResult: "skipped",
      smokeResult: "skipped",
    }).passed,
    false,
  );
  assert.equal(
    evaluateFastAggregate({
      classificationSucceeded: false,
      lane: "invalid",
      classifyResult: "success",
      docsResult: "skipped",
      checksResult: "skipped",
      smokeResult: "skipped",
    }).passed,
    false,
  );
});

test("full aggregate rejects skipped required work and permits one mobile lane", () => {
  assert.equal(
    evaluateFullAggregate({
      classificationSucceeded: true,
      classifyResult: "success",
      fullResult: "success",
      mobileRequired: false,
      mobileWebResult: "success",
      androidResult: "skipped",
    }).passed,
    true,
  );
  assert.equal(
    evaluateFullAggregate({
      classificationSucceeded: true,
      classifyResult: "success",
      fullResult: "skipped",
      mobileRequired: true,
      mobileWebResult: "skipped",
      androidResult: "success",
    }).passed,
    false,
  );
  assert.equal(
    evaluateFullAggregate({
      classificationSucceeded: true,
      classifyResult: "success",
      fullResult: "success",
      mobileRequired: true,
      mobileWebResult: "success",
      androidResult: "skipped",
    }).passed,
    false,
  );
});

test("development workflow has an always-present aggregate and cancellable branch concurrency", () => {
  const workflow = readFileSync(".github/workflows/dev-fast.yml", "utf8");
  assert.match(workflow, /pull_request:\n\s+branches: \[dev\]/);
  assert.match(workflow, /push:\n\s+branches-ignore: \[dev, staging, main\]/);
  assert.match(
    workflow,
    /group: vinifera-dev-fast-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}/,
  );
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(
    workflow,
    /aggregate:\n\s+name: \$\{\{ github\.event_name == 'pull_request' && 'Dev fast checks' \|\| 'Dev branch fast checks' \}\}\n\s+if: always\(\)/,
  );
  assert.match(
    workflow,
    /types: \[opened, synchronize, reopened, ready_for_review, edited\]/,
  );
});

test("development workflow keeps preview evidence independent and unprivileged", () => {
  const workflow = readFileSync(".github/workflows/dev-fast.yml", "utf8");
  const preview = workflow.slice(
    workflow.indexOf("  preview_evidence:"),
    workflow.indexOf("  aggregate:"),
  );
  assert.doesNotMatch(preview, /\n\s+needs:/);
  assert.doesNotMatch(workflow, /\bsecrets\./);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(preview, /cloudflare-workers-and-pages/);
  assert.match(preview, /Cloudflare Pages: vinifera-dev/);
  assert.match(preview, /Cloudflare Pages: vinifera/);
  assert.match(preview, /\| last\) \/\//);
  assert.match(preview, /check-runs\?per_page=100/);
  assert.match(preview, /Immutable deployment URL/);
  assert.match(preview, /Branch alias/);
});

test("full workflow excludes dev pushes and retains promotion-grade coverage", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(workflow, /push:\n\s+branches: \[staging, main\]/);
  assert.doesNotMatch(workflow, /branches: \[dev(?:,|\])/);
  assert.match(workflow, /schedule:\n\s+- cron:/);
  assert.match(workflow, /name: Type, test, build, and package/);
  for (const command of [
    "npm run qa:db:phase1",
    "npm run qa:db:phase2",
    "npm run qa:db:phase3",
    "npm run qa:db:phase4",
    "npm run qa:db:phase5",
    "npm run qa:e2e",
    "npm run build:pages",
    "npm run build:worker",
  ]) {
    assert.ok(workflow.includes(command), command);
  }
});

test("full workflow selects exactly one mobile validation path", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(workflow, /mobile_required == 'true'/);
  assert.match(workflow, /mobile_required != 'true'/);
  assert.match(workflow, /MOBILE_WEB_RESULT.*needs\.mobile_web\.result/);
  assert.match(workflow, /MOBILE_RESULT.*needs\.mobile_android\.result/);
  assert.match(workflow, /"\$MOBILE_WEB_RESULT" != "skipped"/);
  assert.match(workflow, /"\$MOBILE_RESULT" != "success"/);
});
