import test from "node:test";
import assert from "node:assert/strict";
import { calculateAudit, median } from "../src/audit.js";

test("median handles odd and even samples", () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test("audit finds stale, unowned, review response, and overload", () => {
  const report = calculateAudit({
    repository: { owner: "acme", repo: "router", private: false },
    generatedAt: new Date("2026-08-01T00:00:00Z"),
    staleDays: 7,
    maxReviewerLoad: 1,
    openPullRequests: [
      {
        number: 1,
        draft: false,
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-20T00:00:00Z",
        requested_reviewers: [],
        requested_teams: [],
        assignees: [],
      },
      {
        number: 2,
        draft: false,
        created_at: "2026-07-31T00:00:00Z",
        updated_at: "2026-07-31T00:00:00Z",
        requested_reviewers: [{ login: "sam" }],
      },
    ],
    recentPullRequests: [
      {
        pullRequest: { number: 3, created_at: "2026-07-30T00:00:00Z" },
        reviews: [
          {
            state: "APPROVED",
            submitted_at: "2026-07-30T12:00:00Z",
            user: { login: "sam" },
          },
          {
            state: "COMMENTED",
            submitted_at: "2026-07-30T13:00:00Z",
            user: { login: "lee" },
          },
          {
            state: "APPROVED",
            submitted_at: "2026-07-30T14:00:00Z",
            user: { login: "sam" },
          },
        ],
      },
    ],
    codeowners: { present: true, gapCount: 0, gaps: [] },
  });

  assert.equal(report.stalePullRequests.count, 1);
  assert.equal(report.unownedPullRequests.count, 1);
  assert.equal(report.medianFirstReviewHours.value, 12);
  assert.equal(report.reviewerConcentration.value, 66.7);
  assert.deepEqual(report.overloadedReviewers.reviewers, [{ login: "sam", openRequests: 1 }]);
  assert.match(report.readmeMarkdown, /Powered|PR review health/);
});
