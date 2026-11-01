# Review Router Audit

[![Test](https://github.com/tenpace-app/review-router-audit/actions/workflows/test.yml/badge.svg)](https://github.com/tenpace-app/review-router-audit/actions/workflows/test.yml)

Review Router Audit checks the review queue in a GitHub repository. It writes a job summary and a JSON report.

The Action reports:

- Stale open pull requests
- Open pull requests with no requested reviewer, review team, or assignee
- Median time to the first submitted review
- Review concentration for the busiest reviewer
- Changed files with no CODEOWNERS match
- Reviewers with many open requests
- A review-health score from 0 to 100
- A live README badge and a public Review Router report link

The Action does not send data to Review Router. It uses the repository-scoped `GITHUB_TOKEN` to read GitHub data. The live badge and public report use public GitHub data when someone opens them.

By default, the Action still sends no repository data to Tenpace. An explicit `create-setup-link: true` input creates only a declarative, human-authenticated setup session using GitHub Actions OIDC. The agent never receives provider credentials.

## Routing plans

Review Router Team includes MCP setup: **30 days free with a card**, then **$5 per developer/month** or **$50 per developer/year**. The subscription renews automatically; cancel in Billing before the trial ends to avoid a charge. There is no permanent free routing plan.

The **public review-health audit remains free** and does not require a card. [Review current plan details](https://review-router.tenpace.com/#plans).

## Try it without installing anything

[Check a public repository](https://review-router.tenpace.com/tools/pr-review-health) without an account, then add its live badge if the report is useful. For private repositories, run this Action inside GitHub and keep the report private; do not publish a public badge for a private repository.

[How to interpret the audit](https://review-router.tenpace.com/docs/review-health) explains the thresholds and limitations. A score is a starting point for a conversation, not a ranking of developers.

## Fix the handoff after the audit

If PRs repeatedly lack an owner or wait in the wrong channel, [set up routing with your coding assistant](https://review-router.tenpace.com/docs/mcp), or use the [Setup Action](https://github.com/tenpace-app/review-router-setup). You confirm provider access in the browser. A setup test proves connectivity; check a real PR before calling the workflow complete.

## Add the audit

Create `.github/workflows/review-health.yml`:

```yaml
name: Review health

on:
  workflow_dispatch:
  schedule:
    - cron: "17 9 * * 1"

permissions:
  contents: read
  pull-requests: read

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: tenpace-app/review-router-audit@v1
        id: audit

      - uses: actions/upload-artifact@v7
        with:
          name: review-router-audit
          path: ${{ steps.audit.outputs.report-path }}
```

The Action writes the Markdown summary to the workflow run. The optional upload step makes the JSON report downloadable.

## Inputs

- `github-token`: GitHub token. The default is `${{ github.token }}`.
- `stale-days`: Days without an update before a pull request is stale. The default is `7`.
- `sample-size`: Recently closed pull requests used for review metrics. The default is `40`. The maximum is `100`.
- `max-reviewer-load`: Open requests that mark a reviewer as overloaded. The default is `4`.
- `report-path`: JSON report path. The default is `review-router-audit.json`. Use an empty value to skip the file.
- `comment`: Post or update a pull request comment. The default is `false`.
- `fail-below`: Fail when the score is below this value. The default is empty, so the Action reports without blocking.
- `create-setup-link`: Add a short-lived human Review Router authorization link to the summary. Default: `false`.
- `slack-channel`: Proposed channel for the optional link. Default: `pull-requests`.
- `setup-preset`: `repo-watch`, `full-coverage`, or `team-activity`. Default: `repo-watch`.
- `reviewer-mentions`: `all`, `connected-only`, or `none`. Default: `all`.

## Outputs

The Action provides these outputs:

- `score`
- `stale-count`
- `unowned-count`
- `median-first-review-hours`
- `reviewer-concentration`
- `codeowners-gap-count`
- `overloaded-reviewer-count`
- `report-path`
- `badge-url`
- `health-url`
- `setup-id`
- `setup-url`

## Optional setup link

Turn an audit into an opt-in setup funnel without placing provider tokens in workflow inputs:

```yaml
permissions:
  contents: read
  pull-requests: read
  id-token: write

steps:
  - uses: tenpace-app/review-router-audit@v1
    with:
      create-setup-link: true
      slack-channel: pull-requests
```

The audit remains non-blocking if Tenpace is temporarily unavailable. The summary explains the failure and still reports all local metrics. The link contains no claim secret and can only be opened by the GitHub actor in the signed workflow OIDC token.

## Pull request comments

Comments are off by default. Enable them in a workflow that runs for pull request events and grants write access:

```yaml
name: Review health comment

on:
  pull_request_target:
    types: [opened, ready_for_review, review_requested]

permissions:
  contents: read
  pull-requests: write

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: tenpace-app/review-router-audit@v1
        with:
          comment: true
```

This workflow does not check out or execute code from the pull request. Keep that property if you add more steps to a `pull_request_target` workflow.

The Action updates its existing bot comment. It does not add a new comment for every run.

## CODEOWNERS checks

The Action checks these locations in order:

1. `.github/CODEOWNERS`
2. `CODEOWNERS`
3. `docs/CODEOWNERS`

It checks changed files in up to 30 open, non-draft pull requests. It checks up to 100 files in each pull request. The JSON report marks a truncated sample.

CODEOWNERS matching is a practical audit. GitHub remains the authority for branch protection and final owner requests.

## Score

The score uses four components:

- Review ownership: 30%
- Pull request freshness: 30%
- First-review speed: 25%
- Reviewer distribution: 15%

The Action excludes a component when the repository has too little data for it. The JSON report includes each component and its weight.

Metrics describe the repository workflow. They do not measure individual developer performance.

## Badge

Open the Action summary and copy the generated badge Markdown. It has this form:

```markdown
[![PR review health](https://review-router.tenpace.com/review-health/OWNER/REPOSITORY/badge.svg)](https://review-router.tenpace.com/tools/pr-review-health/OWNER/REPOSITORY)
```

## Review Router

[Review Router](https://review-router.tenpace.com/) sends GitHub pull request updates to Slack and mentions the selected reviewers. A Free plan and paid plans are available; see the [current limits and trial terms](https://review-router.tenpace.com/#plans). This audit Action remains free to use, subject to GitHub Actions usage limits.

## License

MIT
