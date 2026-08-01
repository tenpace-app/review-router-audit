import { minimatch } from "minimatch";

export const CODEOWNERS_LOCATIONS = [
  ".github/CODEOWNERS",
  "CODEOWNERS",
  "docs/CODEOWNERS",
];

function removeComment(line) {
  const commentIndex = line.search(/(^|\s)#/);
  return commentIndex === -1 ? line : line.slice(0, commentIndex).trimEnd();
}

export function parseCodeowners(content) {
  const rules = [];
  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    const line = removeComment(rawLine).trim();
    if (!line) continue;
    const [pattern, ...owners] = line.split(/\s+/);
    const validOwners = owners.filter((owner) => owner.startsWith("@"));
    if (!pattern || validOwners.length === 0 || pattern.startsWith("!")) continue;
    rules.push({ pattern, owners: validOwners, line: index + 1 });
  }
  return rules;
}

function normalizedPattern(pattern) {
  let value = pattern.startsWith("/") ? pattern.slice(1) : pattern;
  if (value.endsWith("/")) value += "**";
  return value;
}

export function ruleMatchesFile(rule, file) {
  const pattern = normalizedPattern(rule.pattern);
  const hasDirectory = pattern.includes("/");
  return minimatch(file, pattern, {
    dot: true,
    matchBase: !hasDirectory,
    nocase: false,
  });
}

export function ownersForFile(rules, file) {
  let owners = [];
  for (const rule of rules) {
    if (ruleMatchesFile(rule, file)) owners = rule.owners;
  }
  return owners;
}

export function findCodeownersGaps(rules, pullRequestsWithFiles, options = {}) {
  const present = options.present ?? true;
  const gaps = pullRequestsWithFiles
    .map(({ pullRequest, files, truncated = false }) => {
      const uncoveredFiles = present
        ? files.filter((file) => ownersForFile(rules, file).length === 0)
        : files;
      return uncoveredFiles.length === 0
        ? null
        : {
            number: pullRequest.number,
            uncoveredFileCount: uncoveredFiles.length,
            uncoveredFiles: uncoveredFiles.slice(0, 20),
            filesTruncated: truncated,
          };
    })
    .filter(Boolean);

  return {
    present,
    path: options.path ?? null,
    ruleCount: rules.length,
    pullRequestsChecked: pullRequestsWithFiles.length,
    pullRequestsTruncated: options.pullRequestsTruncated ?? false,
    gapCount: gaps.length,
    gaps,
  };
}
