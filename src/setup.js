import { createHash } from "node:crypto";

const TENPACE_API_ORIGIN = "https://api.tenpace.com";

const PRESETS = new Map([
  ["repo-watch", "repo_watch"],
  ["repo_watch", "repo_watch"],
  ["full-coverage", "full_coverage"],
  ["full_coverage", "full_coverage"],
  ["team-activity", "team_activity"],
  ["team_activity", "team_activity"],
]);
const MENTIONS = new Map([
  ["all", "all"],
  ["connected-only", "connected_only"],
  ["connected_only", "connected_only"],
  ["none", "none"],
]);

export function validateSetupResponse(payload) {
  if (
    typeof payload?.id !== "string" ||
    !/^rrs_[A-Za-z0-9_-]{6,40}$/.test(payload.id) ||
    typeof payload?.agentToken !== "string" ||
    !/^rr_setup_[A-Za-z0-9_-]{6,100}$/.test(payload.agentToken)
  ) {
    throw new Error("Tenpace returned an incomplete setup response.");
  }
  let setupUrl;
  try {
    setupUrl = new URL(payload.setupUrl);
  } catch {
    throw new Error("Tenpace returned an invalid human setup URL.");
  }
  if (
    setupUrl.origin !== "https://review-router.tenpace.com" ||
    setupUrl.pathname !== `/setup/${payload.id}` ||
    setupUrl.search ||
    setupUrl.hash
  ) {
    throw new Error("Tenpace returned an invalid human setup URL.");
  }
  return setupUrl.toString();
}

export async function createAuditSetupLink({
  core,
  fetchImpl = fetch,
  environment = process.env,
  owner,
  repo,
}) {
  const channel = core.getInput("slack-channel").trim().replace(/^#/, "");
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(channel)) {
    throw new Error("slack-channel must be a valid Slack channel name.");
  }
  const presetInput = core.getInput("setup-preset").trim().toLowerCase();
  const preset = PRESETS.get(presetInput);
  if (!preset) throw new Error("setup-preset must be repo-watch, full-coverage, or team-activity.");
  const mentionsInput = core.getInput("reviewer-mentions").trim().toLowerCase();
  const reviewerMentions = MENTIONS.get(mentionsInput);
  if (!reviewerMentions) {
    throw new Error("reviewer-mentions must be all, connected-only, or none.");
  }
  let oidcToken;
  try {
    oidcToken = await core.getIDToken(TENPACE_API_ORIGIN);
  } catch {
    throw new Error(
      "Setup links require `id-token: write` workflow permission. The audit itself does not."
    );
  }
  core.setSecret(oidcToken);
  const intent = {
    repository: `${owner}/${repo}`,
    slackChannel: channel,
    preset,
    reviewerMentions,
  };
  const idempotencyKey = `review-router-audit:${createHash("sha256")
    .update(
      JSON.stringify({
        repository: environment.GITHUB_REPOSITORY_ID || `${owner}/${repo}`,
        runId: environment.GITHUB_RUN_ID || "unknown",
        intent,
      })
    )
    .digest("hex")}`;
  const response = await fetchImpl(`${TENPACE_API_ORIGIN}/v1/review-router/setup-sessions`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${oidcToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "User-Agent": "review-router-audit-action/1.1.2",
    },
    body: JSON.stringify({ source: "review_health_audit", intent }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `Tenpace returned HTTP ${response.status}.`);
  }
  const setupUrl = validateSetupResponse(payload);
  core.setSecret(payload.agentToken);
  return { id: payload.id, url: setupUrl };
}
