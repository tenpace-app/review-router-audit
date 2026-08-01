import fs from "node:fs/promises";
import path from "node:path";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { calculateAudit } from "./audit.js";
import {
  CODEOWNERS_LOCATIONS,
  findCodeownersGaps,
  parseCodeowners,
} from "./codeowners.js";
import { commentMarkdown, summaryMarkdown } from "./report.js";
import { createAuditSetupLink } from "./setup.js";

const MAX_OPEN_PULL_REQUESTS = 100;
const MAX_CODEOWNERS_PULL_REQUESTS = 30;
const MAX_FILES_PER_PULL_REQUEST = 100;

function integerInput(name, fallback, { min = 1, max = 100 } = {}) {
  const raw = core.getInput(name).trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

async function mapWithConcurrency(values, limit, mapper) {
  const output = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await mapper(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return output;
}

function isNotFound(error) {
  return error?.status === 404;
}

async function loadCodeowners(octokit, owner, repo) {
  for (const location of CODEOWNERS_LOCATIONS) {
    try {
      const response = await octokit.rest.repos.getContent({ owner, repo, path: location });
      if (!Array.isArray(response.data) && response.data.type === "file" && response.data.content) {
        const content = Buffer.from(response.data.content, response.data.encoding || "base64").toString(
          "utf8"
        );
        return { present: true, path: location, rules: parseCodeowners(content) };
      }
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
  return { present: false, path: null, rules: [] };
}

async function loadPullRequestFiles(octokit, owner, repo, pullRequests) {
  return mapWithConcurrency(pullRequests, 5, async (pullRequest) => {
    const response = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: pullRequest.number,
      per_page: MAX_FILES_PER_PULL_REQUEST,
    });
    return {
      pullRequest,
      files: response.data.map((file) => file.filename),
      truncated:
        response.data.length === MAX_FILES_PER_PULL_REQUEST &&
        /rel="next"/.test(response.headers.link ?? ""),
    };
  });
}

async function writeReport(reportPath, report) {
  if (!reportPath) return "";
  const resolved = path.resolve(process.cwd(), reportPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return reportPath;
}

async function upsertPullRequestComment(octokit, owner, repo, issueNumber, body) {
  const marker = "<!-- review-router-audit -->";
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100,
  });
  const existing = comments.find(
    (comment) => comment.user?.type === "Bot" && comment.body?.includes(marker)
  );
  if (existing) {
    await octokit.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
    return;
  }
  await octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body });
}

export async function run() {
  const token = core.getInput("github-token", { required: true });
  const staleDays = integerInput("stale-days", 7, { max: 365 });
  const sampleSize = integerInput("sample-size", 40, { max: 100 });
  const maxReviewerLoad = integerInput("max-reviewer-load", 4, { max: 100 });
  const reportPath = core.getInput("report-path").trim();
  const comment = core.getBooleanInput("comment");
  const failBelowRaw = core.getInput("fail-below").trim();
  const failBelow = failBelowRaw
    ? integerInput("fail-below", 0, { min: 0, max: 100 })
    : null;
  const createSetupLink = core.getBooleanInput("create-setup-link");
  const { owner, repo } = github.context.repo;
  const octokit = github.getOctokit(token);

  const repositoryResponse = await octokit.rest.repos.get({ owner, repo });
  const openResponse = await octokit.rest.pulls.list({
    owner,
    repo,
    state: "open",
    sort: "updated",
    direction: "desc",
    per_page: MAX_OPEN_PULL_REQUESTS,
  });
  const closedResponse = await octokit.rest.pulls.list({
    owner,
    repo,
    state: "closed",
    sort: "updated",
    direction: "desc",
    per_page: sampleSize,
  });
  const recentPullRequests = await mapWithConcurrency(
    closedResponse.data.slice(0, sampleSize),
    6,
    async (pullRequest) => ({
      pullRequest,
      reviews: (
        await octokit.rest.pulls.listReviews({
          owner,
          repo,
          pull_number: pullRequest.number,
          per_page: 100,
        })
      ).data,
    })
  );

  const codeownersFile = await loadCodeowners(octokit, owner, repo);
  const activeOpen = openResponse.data.filter((pullRequest) => !pullRequest.draft);
  const pullsForCoverage = activeOpen.slice(0, MAX_CODEOWNERS_PULL_REQUESTS);
  const pullsWithFiles = await loadPullRequestFiles(octokit, owner, repo, pullsForCoverage);
  const codeowners = findCodeownersGaps(codeownersFile.rules, pullsWithFiles, {
    present: codeownersFile.present,
    path: codeownersFile.path,
    pullRequestsTruncated: activeOpen.length > pullsForCoverage.length,
  });

  const report = calculateAudit({
    repository: { owner, repo, private: repositoryResponse.data.private },
    openPullRequests: openResponse.data,
    recentPullRequests,
    codeowners,
    staleDays,
    maxReviewerLoad,
    openPullRequestsTruncated:
      openResponse.data.length === MAX_OPEN_PULL_REQUESTS &&
      /rel="next"/.test(openResponse.headers.link ?? ""),
  });
  let setup = null;
  if (createSetupLink) {
    try {
      setup = await createAuditSetupLink({ core, owner, repo });
    } catch (error) {
      core.warning(
        `The audit completed, but the optional setup link was not created: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  const markdown = summaryMarkdown(report, setup);
  await core.summary.addRaw(markdown).write();
  const writtenReportPath = await writeReport(reportPath, report);

  core.setOutput("score", report.score ?? "n/a");
  core.setOutput("stale-count", report.stalePullRequests.count);
  core.setOutput("unowned-count", report.unownedPullRequests.count);
  core.setOutput("median-first-review-hours", report.medianFirstReviewHours.value ?? "n/a");
  core.setOutput("reviewer-concentration", report.reviewerConcentration.value ?? "n/a");
  core.setOutput("codeowners-gap-count", report.codeowners.gapCount);
  core.setOutput("overloaded-reviewer-count", report.overloadedReviewers.count);
  core.setOutput("report-path", writtenReportPath);
  core.setOutput("badge-url", report.badgeUrl ?? "");
  core.setOutput("health-url", report.healthUrl ?? "");
  core.setOutput("setup-id", setup?.id ?? "");
  core.setOutput("setup-url", setup?.url ?? "");

  if (comment) {
    const issueNumber = github.context.payload.pull_request?.number;
    if (!issueNumber) {
      core.warning("comment is true, but this workflow did not run for a pull_request event.");
    } else {
      await upsertPullRequestComment(
        octokit,
        owner,
        repo,
        issueNumber,
        commentMarkdown(report)
      );
    }
  }

  if (failBelow !== null && report.score !== null && report.score < failBelow) {
    core.setFailed(`Review-health score ${report.score} is below ${failBelow}.`);
  }
}
