import assert from "node:assert/strict";
import test from "node:test";
import {
  changedLineCounts,
  createdPullRequestCount,
  createsGitCommit,
  languageForPath,
  parseHeaders,
  resolveMetricsEndpoint,
  sessionStartType,
} from "../src/core.ts";

test("resolves standard OTLP metrics endpoint without duplication", () => {
  assert.equal(
    resolveMetricsEndpoint("https://collector.example"),
    "https://collector.example/v1/metrics",
  );
  assert.equal(
    resolveMetricsEndpoint("https://collector.example/v1/metrics"),
    "https://collector.example/v1/metrics",
  );
  assert.equal(
    resolveMetricsEndpoint("https://ignored.example", "https://metrics.example/custom"),
    "https://metrics.example/custom",
  );
});

test("maps Pi session reasons to Claude start types", () => {
  assert.equal(sessionStartType("startup", false), "fresh");
  assert.equal(sessionStartType("startup", true), "continue");
  assert.equal(sessionStartType("new", true), "fresh");
  assert.equal(sessionStartType("resume", true), "resume");
  assert.equal(sessionStartType("fork", true), "continue");
  assert.equal(sessionStartType("reload", true), undefined);
});

test("counts added and removed lines", () => {
  assert.deepEqual(changedLineCounts("alpha\nbeta\n", "alpha\ngamma\ndelta\n"), {
    added: 2,
    removed: 1,
  });
  assert.deepEqual(changedLineCounts("", "one\ntwo"), { added: 2, removed: 0 });
});

test("maps file extensions to dashboard languages", () => {
  assert.equal(languageForPath("src/index.ts"), "TypeScript");
  assert.equal(languageForPath("tool.py"), "Python");
  assert.equal(languageForPath("unknown.xyz"), "unknown");
});

test("counts only successful-looking PR creation URLs", () => {
  assert.equal(
    createdPullRequestCount(
      "glab mr create --fill",
      "Created merge request https://gitlab.example/group/repo/-/merge_requests/42",
    ),
    1,
  );
  assert.equal(
    createdPullRequestCount(
      "gh pr create",
      "https://github.com/org/repo/pull/7\nhttps://github.com/org/repo/pull/7",
    ),
    1,
  );
  assert.equal(
    createdPullRequestCount("echo gh pr create", "https://github.com/org/repo/pull/7"),
    0,
  );
  assert.equal(
    createdPullRequestCount("gh pr create --dry-run", "https://github.com/org/repo/pull/7"),
    0,
  );
});

test("recognizes commit creation without matching quoted examples", () => {
  assert.equal(createsGitCommit("git commit -m 'message'"), true);
  assert.equal(createsGitCommit("git status && git commit --amend --no-edit"), true);
  assert.equal(createsGitCommit("echo git commit -m example"), false);
  assert.equal(createsGitCommit("git commit --dry-run"), false);
});

test("parses and decodes OTLP headers without truncating equals", () => {
  assert.deepEqual(parseHeaders("Authorization=Bearer%20abc%3D%3D,X-Tenant=claude-code"), {
    Authorization: "Bearer abc==",
    "X-Tenant": "claude-code",
  });
});
