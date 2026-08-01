export const DEFAULT_STALE_DAYS = 7;

export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

const round = (value, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

function responseScore(hours) {
  if (hours === null) return null;
  if (hours <= 12) return 100;
  if (hours <= 24) return 90;
  if (hours <= 48) return 75;
  if (hours <= 72) return 60;
  if (hours <= 168) return 35;
  return 10;
}

function concentrationScore(share, reviewCount) {
  if (share === null || reviewCount < 3) return null;
  if (share <= 35) return 100;
  if (share <= 50) return 80;
  if (share <= 65) return 55;
  if (share <= 80) return 30;
  return 10;
}

function scoreFromComponents(components) {
  const available = components.filter((component) => component.score !== null);
  if (available.length === 0) return null;
  const totalWeight = available.reduce((sum, component) => sum + component.weight, 0);
  return Math.round(
    available.reduce((sum, component) => sum + component.score * component.weight, 0) /
      totalWeight
  );
}

function firstSubmittedReview(pullRequest, reviews) {
  const createdAt = new Date(pullRequest.created_at).getTime();
  return reviews
    .filter(
      (review) =>
        review.submitted_at &&
        review.user?.login &&
        !["PENDING", "DISMISSED"].includes(review.state.toUpperCase())
    )
    .map((review) => new Date(review.submitted_at).getTime())
    .filter((submittedAt) => Number.isFinite(submittedAt) && submittedAt >= createdAt)
    .sort((left, right) => left - right)[0];
}

export function calculateAudit({
  repository,
  openPullRequests,
  recentPullRequests,
  codeowners,
  staleDays = DEFAULT_STALE_DAYS,
  maxReviewerLoad = 4,
  openPullRequestsTruncated = false,
  generatedAt = new Date(),
}) {
  const now = generatedAt.getTime();
  const active = openPullRequests.filter((pullRequest) => !pullRequest.draft);
  const staleBefore = now - staleDays * 24 * 60 * 60 * 1000;
  const stale = active.filter(
    (pullRequest) => new Date(pullRequest.updated_at).getTime() < staleBefore
  );
  const unowned = active.filter(
    (pullRequest) =>
      (pullRequest.requested_reviewers?.length ?? 0) === 0 &&
      (pullRequest.requested_teams?.length ?? 0) === 0 &&
      (pullRequest.assignees?.length ?? 0) === 0
  );

  const openRequestsByReviewer = new Map();
  for (const pullRequest of active) {
    for (const reviewer of pullRequest.requested_reviewers ?? []) {
      openRequestsByReviewer.set(
        reviewer.login,
        (openRequestsByReviewer.get(reviewer.login) ?? 0) + 1
      );
    }
  }

  const firstReviewHours = [];
  const reviewsByLogin = new Map();
  let reviewCount = 0;
  for (const { pullRequest, reviews } of recentPullRequests) {
    const firstReview = firstSubmittedReview(pullRequest, reviews);
    if (firstReview !== undefined) {
      firstReviewHours.push(
        (firstReview - new Date(pullRequest.created_at).getTime()) / (60 * 60 * 1000)
      );
    }
    for (const review of reviews) {
      if (
        !review.user?.login ||
        !review.submitted_at ||
        ["PENDING", "DISMISSED"].includes(review.state.toUpperCase())
      ) {
        continue;
      }
      reviewCount += 1;
      reviewsByLogin.set(review.user.login, (reviewsByLogin.get(review.user.login) ?? 0) + 1);
    }
  }

  const medianValue = median(firstReviewHours);
  const medianFirstReviewHours = medianValue === null ? null : round(medianValue, 1);
  const sortedReviewers = [...reviewsByLogin.entries()].sort(
    ([leftLogin, leftCount], [rightLogin, rightCount]) =>
      rightCount - leftCount || leftLogin.localeCompare(rightLogin)
  );
  const topReviewer = sortedReviewers[0] ?? null;
  const reviewerConcentration =
    topReviewer && reviewCount > 0 ? round((topReviewer[1] / reviewCount) * 100, 1) : null;
  const overloadedReviewers = [...openRequestsByReviewer.entries()]
    .filter(([, count]) => count >= maxReviewerLoad)
    .sort(([, leftCount], [, rightCount]) => rightCount - leftCount)
    .map(([login, count]) => ({ login, openRequests: count }));

  const openCount = active.length;
  const components = [
    {
      label: "Review ownership",
      score: openCount === 0 ? 100 : round((1 - unowned.length / openCount) * 100),
      weight: 30,
    },
    {
      label: "PR freshness",
      score: openCount === 0 ? 100 : round((1 - stale.length / openCount) * 100),
      weight: 30,
    },
    { label: "First-review speed", score: responseScore(medianFirstReviewHours), weight: 25 },
    {
      label: "Reviewer distribution",
      score: concentrationScore(reviewerConcentration, reviewCount),
      weight: 15,
    },
  ];
  const encodedOwner = encodeURIComponent(repository.owner);
  const encodedRepo = encodeURIComponent(repository.repo);
  const healthUrl = repository.private
    ? null
    : `https://review-router.tenpace.com/tools/pr-review-health/${encodedOwner}/${encodedRepo}`;
  const badgeUrl = repository.private
    ? null
    : `https://review-router.tenpace.com/review-health/${encodedOwner}/${encodedRepo}/badge.svg`;

  return {
    schemaVersion: 1,
    repository: `${repository.owner}/${repository.repo}`,
    score: scoreFromComponents(components),
    scoreComponents: components,
    openPullRequests: {
      count: active.length,
      sampled: openPullRequests.length,
      truncated: openPullRequestsTruncated,
    },
    stalePullRequests: {
      count: stale.length,
      thresholdDays: staleDays,
      numbers: stale.map((pullRequest) => pullRequest.number),
    },
    unownedPullRequests: {
      count: unowned.length,
      numbers: unowned.map((pullRequest) => pullRequest.number),
    },
    medianFirstReviewHours: {
      value: medianFirstReviewHours,
      sampleSize: firstReviewHours.length,
    },
    reviewerConcentration: {
      value: reviewerConcentration,
      topReviewer: topReviewer?.[0] ?? null,
      reviewerCount: reviewsByLogin.size,
      reviewCount,
    },
    overloadedReviewers: {
      threshold: maxReviewerLoad,
      count: overloadedReviewers.length,
      reviewers: overloadedReviewers,
    },
    codeowners,
    definitions: {
      stale: `An open, non-draft PR with no update for ${staleDays} days.`,
      unowned: "An open, non-draft PR with no requested reviewer, review team, or assignee.",
      responseTime: "Time from PR creation to the first submitted review in the recent sample.",
      reviewerConcentration:
        "The percentage of submitted reviews in the recent sample handled by the busiest reviewer.",
    },
    generatedAt: generatedAt.toISOString(),
    healthUrl,
    badgeUrl,
    readmeMarkdown:
      healthUrl && badgeUrl ? `[![PR review health](${badgeUrl})](${healthUrl})` : null,
  };
}
