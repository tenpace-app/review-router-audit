# Review Router Audit

[![Test](https://github.com/Patrax/review-router-audit/actions/workflows/test.yml/badge.svg)](https://github.com/Patrax/review-router-audit/actions/workflows/test.yml)

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
      - uses: Patrax/review-router-audit@v1
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
      - uses: Patrax/review-router-audit@v1
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

[Review Router](https://review-router.tenpace.com/) sends GitHub pull request updates to Slack and mentions the selected reviewers. The public beta is free.

## License

MIT
