import assert from "node:assert/strict";
import test from "node:test";
import { createAuditSetupLink, validateSetupResponse } from "../src/setup.js";

test("creates an opt-in OIDC-bound setup without exposing the setup token", async () => {
  const secrets = [];
  const core = {
    getInput(name) {
      return {
        "slack-channel": "pull-requests",
        "setup-preset": "repo-watch",
        "reviewer-mentions": "all",
      }[name];
    },
    async getIDToken(audience) {
      assert.equal(audience, "https://api.tenpace.com");
      return "oidc.token.value";
    },
    setSecret(value) {
      secrets.push(value);
    },
  };
  let request;
  const result = await createAuditSetupLink({
    core,
    owner: "acme",
    repo: "router",
    environment: { GITHUB_REPOSITORY_ID: "123", GITHUB_RUN_ID: "456" },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(
        JSON.stringify({
          id: "rrs_test01",
          setupUrl: "https://review-router.tenpace.com/setup/rrs_test01",
          agentToken: "rr_setup_secret",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      );
    },
  });
  assert.equal(request.url, "https://api.tenpace.com/v1/review-router/setup-sessions");
  assert.equal(JSON.parse(request.options.body).source, "review_health_audit");
  assert.match(request.options.headers["Idempotency-Key"], /^review-router-audit:[a-f0-9]{64}$/);
  assert.deepEqual(result, {
    id: "rrs_test01",
    url: "https://review-router.tenpace.com/setup/rrs_test01",
  });
  assert.deepEqual(secrets, ["oidc.token.value", "rr_setup_secret"]);
});

test("rejects a secret-bearing setup URL before it reaches the public summary", () => {
  assert.throws(
    () =>
      validateSetupResponse({
        id: "rrs_test01",
        setupUrl: "https://review-router.tenpace.com/setup/rrs_test01#claim=secret",
        agentToken: "rr_setup_secret",
      }),
    /invalid human setup URL/
  );
});
