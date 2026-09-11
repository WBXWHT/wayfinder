const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildCloudAnalysisRequest,
  extractFailureEvidence,
  parseCloudAnalysisResponse,
  redactSensitiveText
} = require("../out/experienceAnalysis.js");
const {
  buildLocalTopicAssessments
} = require("../out/localExperience.js");

test("failure evidence is extracted locally and grouped across hosts", () => {
  const state = projectState([
    node({
      id: "codex-fail",
      host: "codex",
      prompt: "Implement token refresh",
      completedAt: "2026-09-09T10:00:00.000Z",
      validation: {
        command: "npm test",
        status: "failed",
        exitCode: 1,
        summary: "token expired; api_key=super-secret-value"
      }
    }),
    node({
      id: "claude-reject",
      host: "claude",
      prompt: "Fix token refresh expiry",
      completedAt: "2026-09-09T10:01:00.000Z",
      verdict: "failure",
      note: "Bearer abcdefghijklmnopqrstuvwxyz"
    })
  ]);

  const evidence = extractFailureEvidence(state);
  assert.equal(evidence.length, 2);
  assert.equal(new Set(evidence.map((item) => item.topicId)).size, 1);
  assert.deepEqual(
    evidence.map((item) => item.sourceHost).sort(),
    ["claude", "codex"]
  );
  assert.doesNotMatch(JSON.stringify(evidence), /super-secret-value/);
  assert.doesNotMatch(JSON.stringify(evidence), /abcdefghijklmnopqrstuvwxyz/);
});

test("cloud request excludes roots, source code, and healthy turns", () => {
  const failed = node({
    id: "failed",
    host: "codex",
    prompt: "Fix /Users/alice/private-project/src/auth.ts " +
      "const proprietaryAlgorithm = () => 42",
    completedAt: "2026-09-09T10:00:00.000Z",
    validation: {
      status: "failed",
      summary: "test failed"
    }
  });
  const healthy = node({
    id: "healthy",
    host: "claude",
    prompt: "Continue implementation",
    completedAt: "2026-09-09T10:01:00.000Z"
  });
  const request = buildCloudAnalysisRequest(
    projectState([failed, healthy]),
    "2026-09-09T11:00:00.000Z"
  );
  const serialized = JSON.stringify(request);

  assert.equal(request.topics.length, 1);
  assert.equal(request.topics[0].evidence.length, 1);
  assert.equal(request.policy.rawConversationIncluded, false);
  assert.equal(request.policy.sourceCodeIncluded, false);
  assert.equal(request.topics[0].localStatus, "failed-candidate");
  assert.equal(
    request.topics[0].evidence[0].diagnosticCategory,
    "test"
  );
  assert.doesNotMatch(serialized, /private-project/);
  assert.doesNotMatch(serialized, /proprietaryAlgorithm/);
  assert.doesNotMatch(serialized, /Continue implementation/);
});

test("cloud request carries only structured local diagnostics", () => {
  const networkFailure = node({
    id: "network-failure",
    host: "codex",
    prompt: "Run the private deployment",
    completedAt: "2026-09-09T10:00:00.000Z",
    validation: {
      status: "failed",
      exitCode: 2,
      summary: "database connection refused at secret.internal"
    }
  });
  const compileFailure = node({
    id: "compile-failure",
    host: "claude",
    prompt: "Run the private deployment",
    completedAt: "2026-09-09T11:00:00.000Z",
    validation: {
      status: "failed",
      exitCode: 1,
      summary: "type checker rejected proprietary payload"
    }
  });
  compileFailure.files = [{ path: "src/other.ts", status: "M" }];
  const request = buildCloudAnalysisRequest(
    projectState([networkFailure, compileFailure])
  );
  const serialized = JSON.stringify(request);
  const diagnostics = request.topics
    .flatMap((topic) => topic.evidence)
    .map((item) => [item.diagnosticCategory, item.exitCode])
    .sort();

  assert.deepEqual(diagnostics, [["compile", 1], ["network", 2]]);
  assert.doesNotMatch(serialized, /secret\.internal|proprietary payload/);
});

test("cloud response must cite evidence from the local request", () => {
  const state = projectState([
    node({
      id: "failed",
      host: "codex",
      prompt: "Break the build",
      completedAt: "2026-09-09T10:00:00.000Z",
      validation: { status: "failed", summary: "compiler failed" }
    })
  ]);
  const request = buildCloudAnalysisRequest(state);
  const topic = request.topics[0];
  const evidence = topic.evidence[0];
  const parsed = parseCloudAnalysisResponse({
    schemaVersion: 1,
    analyses: [{
      topicId: topic.id,
      evidenceIds: [evidence.id],
      status: "failed",
      summary: "The implementation failed compilation.",
      conditions: ["Current project state"],
      confidence: "high"
    }]
  }, request);

  assert.equal(parsed.analyses[0].status, "failed");
  assert.throws(
    () => parseCloudAnalysisResponse({
      schemaVersion: 1,
      analyses: [{
        topicId: topic.id,
        evidenceIds: ["invented-evidence"],
        status: "failed",
        summary: "Unsupported conclusion",
        conditions: [],
        confidence: "high"
      }]
    }, request),
    /unknown local evidence/
  );
  assert.throws(
    () => parseCloudAnalysisResponse({
      schemaVersion: 1,
      analyses: [{
        topicId: topic.id,
        evidenceIds: [evidence.id],
        status: "superseded",
        summary: "Unsupported recovery",
        conditions: [],
        confidence: "high"
      }]
    }, request),
    /lacks matching local state evidence/
  );
});

test("cloud response cannot cite evidence from another topic", () => {
  const first = node({
    id: "topic-a",
    host: "codex",
    prompt: "Break OAuth callback",
    completedAt: "2026-09-09T10:00:00.000Z",
    validation: { status: "failed", summary: "callback failed" }
  });
  first.files = [{ path: "src/auth/callback.ts", status: "M" }];
  const second = node({
    id: "topic-b",
    host: "claude",
    prompt: "Break invoice export",
    completedAt: "2026-09-09T11:00:00.000Z",
    validation: { status: "failed", summary: "invoice failed" }
  });
  second.files = [{ path: "src/invoice/export.ts", status: "M" }];
  const request = buildCloudAnalysisRequest(projectState([first, second]));
  assert.equal(request.topics.length, 2);

  assert.throws(
    () => parseCloudAnalysisResponse({
      schemaVersion: 1,
      analyses: [{
        topicId: request.topics[0].id,
        evidenceIds: [request.topics[1].evidence[0].id],
        status: "failed",
        summary: "Cross-topic evidence",
        conditions: [],
        confidence: "high"
      }]
    }, request),
    /does not belong to topic/
  );
});

test("cloud response cannot erase a locally proven superseded state", () => {
  const failed = node({
    id: "cloud-old-failure",
    host: "claude",
    prompt: "Implement token refresh",
    completedAt: "2026-09-09T10:00:00.000Z",
    verdict: "failure"
  });
  const recovered = node({
    id: "cloud-recovery",
    host: "claude",
    prompt: "Fix token refresh implementation",
    completedAt: "2026-09-09T10:01:00.000Z",
    validation: { status: "passed" }
  });
  const request = buildCloudAnalysisRequest(
    projectState([failed, recovered])
  );
  const topic = request.topics[0];
  assert.equal(topic.localStatus, "superseded");

  assert.throws(
    () => parseCloudAnalysisResponse({
      schemaVersion: 1,
      analyses: [{
        topicId: topic.id,
        evidenceIds: [topic.evidence[0].id],
        status: "failed",
        summary: "Ignore the local recovery",
        conditions: [],
        confidence: "high"
      }]
    }, request),
    /lacks matching local state evidence/
  );
});

test("a failed Codex attempt and active Claude attempt remain conflicting", () => {
  const codex = node({
    id: "codex-rejected",
    host: "codex",
    prompt: "Implement token refresh",
    completedAt: "2026-09-09T10:00:00.000Z",
    verdict: "failure"
  });
  const claude = node({
    id: "claude-active",
    host: "claude",
    prompt: "Continue token refresh implementation",
    completedAt: "2026-09-09T10:01:00.000Z"
  });
  const assessments = buildLocalTopicAssessments(
    projectState([codex, claude])
  );

  assert.equal(assessments.length, 1);
  assert.equal(assessments[0].status, "conflicting");
  assert.deepEqual(
    assessments[0].sourceHosts.sort(),
    ["claude", "codex"]
  );
});

test("an older healthy attempt does not conflict with a later failure", () => {
  const claude = node({
    id: "claude-old",
    host: "claude",
    prompt: "Implement token refresh",
    completedAt: "2026-09-09T10:00:00.000Z"
  });
  const codex = node({
    id: "codex-later-failure",
    host: "codex",
    prompt: "Fix token refresh",
    completedAt: "2026-09-09T10:01:00.000Z",
    verdict: "failure"
  });
  const assessments = buildLocalTopicAssessments(
    projectState([claude, codex])
  );

  assert.equal(assessments.length, 1);
  assert.equal(assessments[0].status, "failed-candidate");
});

test("another host recovering after both hosts failed remains conflicting", () => {
  const codex = node({
    id: "codex-failed",
    host: "codex",
    prompt: "Implement token refresh",
    completedAt: "2026-09-09T10:00:00.000Z",
    verdict: "failure"
  });
  const claudeFailed = node({
    id: "claude-failed",
    host: "claude",
    prompt: "Fix token refresh",
    completedAt: "2026-09-09T10:01:00.000Z",
    verdict: "failure"
  });
  const claudeRecovered = node({
    id: "claude-recovered",
    host: "claude",
    prompt: "Continue token refresh",
    completedAt: "2026-09-09T10:02:00.000Z",
    validation: { status: "passed" }
  });
  const assessments = buildLocalTopicAssessments(
    projectState([codex, claudeFailed, claudeRecovered])
  );

  assert.equal(assessments.length, 1);
  assert.equal(assessments[0].status, "conflicting");
});

test("one host recovering its own failed route marks it superseded", () => {
  const failed = node({
    id: "claude-failed",
    host: "claude",
    prompt: "Implement token refresh",
    completedAt: "2026-09-09T10:00:00.000Z",
    verdict: "failure"
  });
  const recovered = node({
    id: "claude-recovered",
    host: "claude",
    prompt: "Fix token refresh implementation",
    completedAt: "2026-09-09T10:01:00.000Z",
    validation: { status: "passed" }
  });
  const assessments = buildLocalTopicAssessments(
    projectState([failed, recovered])
  );

  assert.equal(assessments.length, 1);
  assert.equal(assessments[0].status, "superseded");
});

test("validation timeout remains failure evidence instead of a recovery", () => {
  const failed = node({
    id: "claude-failed-before-timeout",
    host: "claude",
    prompt: "Implement token refresh",
    completedAt: "2026-09-09T10:00:00.000Z",
    validation: { status: "failed", summary: "test failed" }
  });
  const timedOut = node({
    id: "claude-timeout",
    host: "claude",
    prompt: "Retry token refresh tests",
    completedAt: "2026-09-09T10:01:00.000Z",
    validation: { status: "timeout", summary: "test timed out" }
  });
  const state = projectState([failed, timedOut]);
  const assessments = buildLocalTopicAssessments(state);
  const evidence = extractFailureEvidence(state);

  assert.equal(assessments.length, 1);
  assert.equal(assessments[0].status, "failed-candidate");
  assert.deepEqual(
    assessments[0].evidenceNodeIds,
    ["claude-failed-before-timeout", "claude-timeout"]
  );
  assert.ok(evidence.some((item) =>
    item.nodeId === "claude-timeout" &&
    item.kind === "validation-timeout"
  ));
});

test("resolved failures from every host do not leave a stale conflict", () => {
  const attempts = [
    node({
      id: "codex-failed",
      host: "codex",
      prompt: "Implement token refresh",
      completedAt: "2026-09-09T10:00:00.000Z",
      verdict: "failure"
    }),
    node({
      id: "codex-recovered",
      host: "codex",
      prompt: "Fix token refresh implementation",
      completedAt: "2026-09-09T10:01:00.000Z",
      validation: { status: "passed" }
    }),
    node({
      id: "claude-failed",
      host: "claude",
      prompt: "Fix token refresh expiry",
      completedAt: "2026-09-09T10:02:00.000Z",
      verdict: "failure"
    }),
    node({
      id: "claude-recovered",
      host: "claude",
      prompt: "Complete token refresh expiry",
      completedAt: "2026-09-09T10:03:00.000Z",
      validation: { status: "passed" }
    })
  ];
  const assessments = buildLocalTopicAssessments(projectState(attempts));

  assert.equal(assessments.length, 1);
  assert.equal(assessments[0].status, "superseded");
});

test("an unverified follow-up does not supersede a proven failure", () => {
  const failed = node({
    id: "codex-failed-unverified",
    host: "codex",
    prompt: "Implement token refresh",
    completedAt: "2026-09-09T10:00:00.000Z",
    verdict: "failure"
  });
  const unverified = node({
    id: "codex-follow-up-unverified",
    host: "codex",
    prompt: "Continue token refresh implementation",
    completedAt: "2026-09-09T10:01:00.000Z",
    validation: { status: "skipped" }
  });

  const assessments = buildLocalTopicAssessments(
    projectState([failed, unverified])
  );

  assert.equal(assessments.length, 1);
  assert.equal(assessments[0].status, "failed-candidate");
});

test("simultaneous success and failure remain conservatively unresolved", () => {
  const passed = node({
    id: "same-time-passed",
    host: "codex",
    prompt: "Validate token refresh",
    completedAt: "2026-09-09T10:00:00.000Z",
    validation: { status: "passed" }
  });
  const failed = node({
    id: "same-time-failed",
    host: "codex",
    prompt: "Validate token refresh",
    completedAt: "2026-09-09T10:00:00.000Z",
    validation: { status: "failed" }
  });

  for (const attempts of [[passed, failed], [failed, passed]]) {
    const assessments = buildLocalTopicAssessments(projectState(attempts));
    assert.equal(assessments.length, 1);
    assert.equal(assessments[0].status, "failed-candidate");
  }
});

test("a host's new failure invalidates its older healthy state", () => {
  const attempts = [
    node({
      id: "codex-unresolved",
      host: "codex",
      prompt: "Implement token refresh",
      completedAt: "2026-09-09T10:00:00.000Z",
      verdict: "failure"
    }),
    node({
      id: "claude-healthy",
      host: "claude",
      prompt: "Continue token refresh implementation",
      completedAt: "2026-09-09T10:01:00.000Z"
    }),
    node({
      id: "claude-failed-again",
      host: "claude",
      prompt: "Retry token refresh implementation",
      completedAt: "2026-09-09T10:02:00.000Z",
      verdict: "failure"
    })
  ];
  const assessments = buildLocalTopicAssessments(projectState(attempts));

  assert.equal(assessments.length, 1);
  assert.equal(assessments[0].status, "failed-candidate");
});

test("redaction removes common credentials and local user names", () => {
  const redacted = redactSensitiveText(
    "email a@example.com password=hunter2 " +
    "Bearer abcdefghijklmnopqrstuv /Users/alice/work"
  );

  assert.equal(
    redacted,
    "email [REDACTED_EMAIL] password=[REDACTED] " +
    "Bearer [REDACTED] [LOCAL_PATH]"
  );
});

test("redaction handles multi-segment tokens and truncated private keys", () => {
  const value =
    "sk-proj-abcdefghijklmnopqrstuvwxyz1234567890 " +
    "sk-ant-api03-abcdefghijklmnopqrstuvwxyz " +
    "glpat-abcdefghijklmnopqrstuvwxyz " +
    "-----BEGIN OPENSSH PRIVATE KEY-----\n" +
    "a".repeat(1_500);
  const redacted = redactSensitiveText(value);

  assert.doesNotMatch(redacted, /sk-proj|sk-ant|glpat/);
  assert.doesNotMatch(redacted, /BEGIN OPENSSH PRIVATE KEY/);
  assert.match(redacted, /REDACTED_PRIVATE_KEY/);
});

function projectState(nodes) {
  return {
    version: 1,
    projectId: "project-hash",
    root: "/Users/alice/private-project",
    activeBranchId: "main",
    branches: [{ id: "main", name: "main", createdAt: nodes[0].startedAt }],
    nodes,
    pending: {},
    updatedAt: nodes.at(-1).completedAt
  };
}

function node({
  id,
  host,
  prompt,
  completedAt,
  validation = { status: "not-configured" },
  verdict,
  note
}) {
  return {
    id,
    kind: "turn",
    sessionId: `${host}-session`,
    sourceHost: host,
    branchId: "main",
    prompt,
    response: "",
    startedAt: completedAt,
    completedAt,
    snapshotBefore: `${id}-before`,
    snapshotAfter: `${id}-after`,
    files: [{ path: "src/auth.ts", status: "M", additions: 1, deletions: 0 }],
    actions: [],
    validation,
    verdict,
    note
  };
}
