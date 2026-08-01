import test from "node:test";
import assert from "node:assert/strict";
import {
  findCodeownersGaps,
  ownersForFile,
  parseCodeowners,
} from "../src/codeowners.js";

test("CODEOWNERS uses the last matching rule", () => {
  const rules = parseCodeowners(`
* @acme/engineering
*.sql @acme/data
/src/payments/ @acme/payments @acme/security # important
`);
  assert.deepEqual(ownersForFile(rules, "src/index.ts"), ["@acme/engineering"]);
  assert.deepEqual(ownersForFile(rules, "db/schema.sql"), ["@acme/data"]);
  assert.deepEqual(ownersForFile(rules, "src/payments/client.ts"), [
    "@acme/payments",
    "@acme/security",
  ]);
});

test("CODEOWNERS gap report lists uncovered files", () => {
  const rules = parseCodeowners("/src/ @acme/engineering");
  const result = findCodeownersGaps(rules, [
    {
      pullRequest: { number: 8 },
      files: ["src/index.ts", "ops/deploy.sh"],
    },
  ]);
  assert.equal(result.gapCount, 1);
  assert.deepEqual(result.gaps[0].uncoveredFiles, ["ops/deploy.sh"]);
});
