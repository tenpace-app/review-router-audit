import test from "node:test";
import assert from "node:assert/strict";
import { summaryMarkdown } from "../src/report.js";

test("summary includes the report and product links", () => {
  const markdown = summaryMarkdown({
    repository: "acme/router",
    score: 82,
    openPullRequests: { count: 4, truncated: false },
    stalePullRequests: { count: 1, numbers: [1] },
    unownedPullRequests: { count: 2, numbers: [2, 3] },
    medianFirstReviewHours: { value: 18 },
    reviewerConcentration: { value: 44 },
    codeowners: { present: true, gapCount: 0, gaps: [] },
    overloadedReviewers: { count: 0, reviewers: [] },
    healthUrl: "https://review-router.tenpace.com/tools/pr-review-health/acme/router",
    badgeUrl: "https://review-router.tenpace.com/review-health/acme/router/badge.svg",
  });
  assert.match(markdown, /82\/100/);
  assert.match(markdown, /Route these reviews to Slack/);
  assert.match(markdown, /badge\.svg/);
});
