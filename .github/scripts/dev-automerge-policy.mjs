import { readFileSync } from "node:fs";

const contractUrl = new URL("../delivery-risk-contract.json", import.meta.url);

export function readDeliveryRiskContract(url = contractUrl) {
  const contract = JSON.parse(readFileSync(url, "utf8"));
  const stringArray = (value) =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.length > 0);
  if (
    contract?.version !== 1 ||
    typeof contract.targetBranch !== "string" ||
    !stringArray(contract.allowedRisks) ||
    !stringArray(contract.blockedRisks) ||
    typeof contract.authorityLabel !== "string" ||
    !stringArray(contract.emergencyLabels) ||
    !stringArray(contract.requiredContexts) ||
    typeof contract.previewContext !== "string" ||
    contract.mergeMethod !== "squash" ||
    contract.sameRepositoryOnly !== true ||
    contract.requireCurrentBase !== true ||
    contract.requireNoActiveChangesRequested !== true
  ) {
    throw new Error("The delivery risk contract is malformed or weakened.");
  }
  return Object.freeze(contract);
}

export function requiredAutomergeContexts({
  contract,
  protectedContexts = [],
  previewRequired = false,
}) {
  const contexts = new Set([
    ...contract.requiredContexts,
    ...protectedContexts,
  ]);
  if (previewRequired) contexts.add(contract.previewContext);
  return [...contexts].sort();
}

export function evaluateAutomergeCandidate({
  contract,
  repository,
  currentBaseSha,
  pullRequest,
  classification,
  contexts,
  activeChangesRequested,
}) {
  if (!pullRequest || pullRequest.state !== "open") {
    return { eligible: false, reason: "pull_request_not_open" };
  }
  if (pullRequest.draft === true) {
    return { eligible: false, reason: "draft_pull_request" };
  }
  if (
    pullRequest.baseRef !== contract.targetBranch ||
    pullRequest.baseSha !== currentBaseSha
  ) {
    return { eligible: false, reason: "base_not_current_target" };
  }
  if (
    pullRequest.headRepository !== repository ||
    pullRequest.baseRepository !== repository
  ) {
    return { eligible: false, reason: "cross_repository_candidate" };
  }
  if (
    !/^[0-9a-f]{40}$/i.test(pullRequest.headSha || "") ||
    !/^[0-9a-f]{40}$/i.test(pullRequest.baseSha || "")
  ) {
    return { eligible: false, reason: "non_exact_revision" };
  }
  const labels = new Set(pullRequest.labels || []);
  if (!labels.has(contract.authorityLabel)) {
    return { eligible: false, reason: "standing_authority_missing" };
  }
  if (contract.emergencyLabels.some((label) => labels.has(label))) {
    return { eligible: false, reason: "emergency_label_present" };
  }
  if (
    classification?.classificationSucceeded !== true ||
    !contract.allowedRisks.includes(classification.risk) ||
    contract.blockedRisks.includes(classification.risk)
  ) {
    return { eligible: false, reason: "risk_not_eligible" };
  }
  if (
    !Number.isInteger(activeChangesRequested) ||
    activeChangesRequested !== 0
  ) {
    return { eligible: false, reason: "blocking_changes_requested_review" };
  }
  if (!Array.isArray(contexts) || contexts.length === 0) {
    return { eligible: false, reason: "required_contexts_missing" };
  }
  const failing = contexts.find(
    ({ state }) => state !== "success",
  );
  if (failing) {
    return {
      eligible: false,
      reason:
        failing.state === "pending"
          ? "required_context_pending"
          : "required_context_failed",
      context: failing.name,
    };
  }
  return { eligible: true, reason: "eligible_exact_candidate" };
}
