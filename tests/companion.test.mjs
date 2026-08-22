import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import * as runtime from "../plugins/claude-adversarial-review/scripts/claude-companion.mjs";
import * as liveProbe from "./live/claude-stream-contract-probe.mjs";

const {
  buildLiveProbeInvocation,
  observeClaudeStream,
  probeContractIsSatisfied
} = liveProbe;

import {
  addWorkingCandidate,
  createRepository,
  git,
  makeTempDirectory,
  projectRoot,
  readInvocation,
  runCompanion,
  snapshotRepository,
  writeText
} from "./helpers/harness.mjs";

function completeFinding(overrides = {}) {
  return {
    severity: "high",
    title: "A concrete defect",
    evidence: "The unsafe branch is reachable when the input is empty.",
    claim: "Empty input reaches the unsafe branch.",
    impact: "The operation can produce an invalid result.",
    file: "src/example.js",
    line_start: 7,
    line_end: 9,
    inference: "direct",
    confidence: 0.91,
    recommendation: "Reject empty input before entering the unsafe branch.",
    ...overrides
  };
}

test("schema evaluator rejects every supported keyword violation", async (t) => {
  assert.equal(
    typeof runtime.validateJsonSchemaSubset,
    "function",
    "validateJsonSchemaSubset is not exported"
  );
  const cases = [
    ["type", { type: "string" }, 7],
    [
      "required",
      { type: "object", required: ["x"], properties: { x: {} } },
      {}
    ],
    [
      "additionalProperties",
      { type: "object", additionalProperties: false, properties: {} },
      { x: 1 }
    ],
    ["enum", { enum: ["a", "b"] }, "c"],
    ["const", { const: "a" }, "b"],
    ["minLength", { type: "string", minLength: 1 }, ""],
    ["maxLength", { type: "string", maxLength: 1 }, "ab"],
    ["minimum", { type: "number", minimum: 0 }, -1],
    ["maximum", { type: "number", maximum: 1 }, 2],
    ["items", { type: "array", items: { type: "integer" } }, [1, 1.5]],
    ["unique string items", { type: "array", uniqueItems: true }, ["x", "x"]],
    [
      "unique object items",
      { type: "array", uniqueItems: true },
      [{ x: 1 }, { x: 1 }]
    ],
    ["unique array items", { type: "array", uniqueItems: true }, [[1], [1]]],
    ["minItems", { type: "array", minItems: 1 }, []],
    ["maxItems", { type: "array", maxItems: 0 }, [1]],
    ["oneOf no match", { oneOf: [{ const: "a" }, { type: "number" }] }, true],
    ["oneOf two matches", { oneOf: [{ type: "number" }, { minimum: 0 }] }, 1],
    ["local ref", { $defs: { value: { type: "string" } }, $ref: "#/$defs/value" }, 1]
  ];
  for (const [name, schema, value] of cases) {
    await t.test(name, () => {
      assert.throws(
        () => runtime.validateJsonSchemaSubset(schema, value),
        (error) => error?.code === "INVALID_CLAUDE_RESULT"
      );
    });
  }
});

test("schema evaluator retains explicit $defs compatibility", () => {
  runtime.validateJsonSchemaSubset(
    {
      $defs: { value: { type: "string", minLength: 1 } },
      oneOf: [{ $ref: "#/$defs/value" }, { type: "number" }]
    },
    "accepted"
  );
});

test("schema evaluator accepts a Draft-07 definitions ref", () => {
  runtime.validateJsonSchemaSubset(
    {
      definitions: { value: { type: "string", minLength: 1 } },
      $ref: "#/definitions/value"
    },
    "accepted"
  );
});

test("schema evaluator enforces a Draft-07 definitions ref", () => {
  assert.throws(
    () => runtime.validateJsonSchemaSubset(
      {
        definitions: { value: { type: "string", minLength: 1 } },
        $ref: "#/definitions/value"
      },
      1
    ),
    (error) => error?.code === "INVALID_CLAUDE_RESULT"
  );
});

test("runtime enforces verdict and findings semantics without schema oneOf", async (t) => {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      verdict: {
        type: "string",
        enum: ["MATERIAL_FINDINGS", "NO_MATERIAL_FINDINGS_STATIC"]
      },
      findings: { type: "array" }
    },
    required: ["verdict", "findings"]
  };
  assert.equal(Object.hasOwn(schema, "oneOf"), false);
  const cases = [
    [
      "rejects a static verdict with findings",
      { verdict: "NO_MATERIAL_FINDINGS_STATIC", findings: [{}] },
      false
    ],
    [
      "rejects a material verdict without findings",
      { verdict: "MATERIAL_FINDINGS", findings: [] },
      false
    ],
    [
      "accepts a static verdict without findings",
      { verdict: "NO_MATERIAL_FINDINGS_STATIC", findings: [] },
      true
    ],
    [
      "accepts a material verdict with findings",
      { verdict: "MATERIAL_FINDINGS", findings: [{}] },
      true
    ]
  ];
  for (const [name, value, accepted] of cases) {
    await t.test(name, () => {
      runtime.validateJsonSchemaSubset(schema, value);
      if (accepted) {
        assert.doesNotThrow(() => runtime.validateReviewResultSemantics(value));
      } else {
        assert.throws(
          () => runtime.validateReviewResultSemantics(value),
          (error) => error?.code === "INVALID_CLAUDE_RESULT"
        );
      }
    });
  }
});

test("schema uniqueItems evaluation reads a bounded array linearly and canonically", () => {
  const values = Array.from({ length: 100 }, (_, index) => ({
    index,
    nested: [index, { parity: index % 2 }]
  }));
  let indexedReads = 0;
  const observed = new Proxy(values, {
    get(target, property, receiver) {
      if (typeof property === "string" && /^(?:0|[1-9]\d*)$/.test(property)) {
        indexedReads += 1;
      }
      return Reflect.get(target, property, receiver);
    }
  });

  runtime.validateJsonSchemaSubset(
    { type: "array", uniqueItems: true },
    observed
  );

  assert.ok(
    indexedReads <= values.length * 2,
    `uniqueItems used ${indexedReads} indexed reads for ${values.length} entries`
  );
  assert.throws(
    () => runtime.validateJsonSchemaSubset(
      { type: "array", uniqueItems: true },
      [{ alpha: 1, beta: [2, 3] }, { beta: [2, 3], alpha: 1 }]
    ),
    (error) => error?.code === "INVALID_CLAUDE_RESULT"
  );
});

test("schema uniqueItems evaluation fails closed above its result-array bound", () => {
  const oversized = Array.from({ length: 50_000 }, (_, index) => `step-${index}`);

  assert.throws(
    () => runtime.validateJsonSchemaSubset(
      { type: "array", uniqueItems: true },
      oversized
    ),
    (error) => error?.code === "INVALID_CLAUDE_RESULT"
  );
});

test("schema loader rejects an unsupported keyword", () => {
  assert.equal(
    typeof runtime.validateSupportedSchema,
    "function",
    "validateSupportedSchema is not exported"
  );
  assert.throws(
    () => runtime.validateSupportedSchema({ type: "string", pattern: "^x$" }),
    (error) => error?.code === "INVALID_SCHEMA"
  );
});

test("schema maxLength counts Unicode code points at its exact boundary", () => {
  assert.doesNotThrow(() =>
    runtime.validateJsonSchemaSubset(
      { type: "string", minLength: 2, maxLength: 2 },
      "😀x"
    )
  );
  assert.throws(
    () => runtime.validateJsonSchemaSubset(
      { type: "string", maxLength: 1 },
      "😀x"
    ),
    (error) => error?.code === "INVALID_CLAUDE_RESULT"
  );
});

test("schema string-length rejection remains bounded for a very large value", () => {
  const runtimeUrl = pathToFileURL(
    join(
      projectRoot,
      "plugins",
      "claude-adversarial-review",
      "scripts",
      "claude-companion.mjs"
    )
  ).href;
  const script = [
    `import { validateJsonSchemaSubset } from ${JSON.stringify(runtimeUrl)};`,
    'const value = "😀".repeat(4_000_000);',
    "try { validateJsonSchemaSubset({ type: 'string', maxLength: 1 }, value); process.exit(2); }",
    "catch (error) { process.exit(error?.code === 'INVALID_CLAUDE_RESULT' ? 0 : 3); }"
  ].join("\n");
  const result = spawnSync(
    process.execPath,
    ["--max-old-space-size=48", "--input-type=module", "--eval", script],
    { encoding: "utf8", timeout: 10_000 }
  );
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});

test("live probe derives its lead, agents, schema, and tool flags from production argv", () => {
  assert.equal(typeof runtime.buildClaudeArguments, "function");
  const invocation = buildLiveProbeInvocation();
  assert.deepEqual(
    invocation.argv,
    runtime.buildClaudeArguments(invocation.schema, invocation.agents)
  );
  assert.ok(invocation.agents["lead-reviewer"]);
  assert.equal(invocation.agents.lead, undefined);
  const valueAfter = (flag) => invocation.argv[invocation.argv.indexOf(flag) + 1];
  assert.equal(valueAfter("--agent"), "lead-reviewer");
  assert.equal(valueAfter("--tools"), "Agent");
  assert.equal(
    valueAfter("--allowedTools"),
    "Agent(correctness-reviewer,scope-reviewer)"
  );
  assert.deepEqual(JSON.parse(valueAfter("--json-schema")), invocation.schema);
  assert.deepEqual(JSON.parse(valueAfter("--agents")), invocation.agents);
});

test("fake Claude fails closed when the production argv contract is mutated", async (t) => {
  const cwd = createRepository(t);
  addWorkingCandidate(cwd);
  const captured = runCompanion(cwd);
  assert.equal(captured.status, 0, captured.stderr);
  const fixture = join(projectRoot, "tests", "fixtures", "fake-claude.mjs");
  const invoke = (argv) => spawnSync(process.execPath, [fixture, ...argv], {
    encoding: "utf8",
    input: "synthetic review input",
    env: { ...process.env, FAKE_CLAUDE_STREAM: "0" }
  });
  const replaceValue = (argv, flag, replacement) => {
    const mutated = [...argv];
    const index = mutated.indexOf(flag);
    assert.notEqual(index, -1, `missing fixture flag ${flag}`);
    mutated[index + 1] = replacement(mutated[index + 1]);
    return mutated;
  };
  const removeFlag = (argv, flag) => {
    const mutated = [...argv];
    const index = mutated.indexOf(flag);
    assert.notEqual(index, -1, `missing fixture flag ${flag}`);
    mutated.splice(index, 2);
    return mutated;
  };
  const mutateAgents = (encoded) => {
    const value = JSON.parse(encoded);
    delete value["scope-reviewer"];
    return JSON.stringify(value);
  };
  const mutateSchema = (encoded) => {
    const value = JSON.parse(encoded);
    value.title = `${value.title} mutated`;
    return JSON.stringify(value);
  };

  const baseline = invoke(captured.invocation.argv);
  assert.equal(baseline.status, 0, baseline.stderr);
  for (const [name, argv] of [
    ["missing tools", removeFlag(captured.invocation.argv, "--tools")],
    ["mutated tools", replaceValue(captured.invocation.argv, "--tools", () => "Task")],
    ["mutated allowed tools", replaceValue(captured.invocation.argv, "--allowedTools", () => "Agent")],
    ["mutated lead agent", replaceValue(captured.invocation.argv, "--agent", () => "scope-reviewer")],
    ["mutated agents", replaceValue(captured.invocation.argv, "--agents", mutateAgents)],
    ["mutated schema", replaceValue(captured.invocation.argv, "--json-schema", mutateSchema)]
  ]) {
    await t.test(name, () => {
      const result = invoke(argv);
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stdout, /"subtype":"success"/);
      assert.match(result.stderr, /FAKE_CLAUDE_INVALID_ARGV/);
    });
  }
});

test("bundled structured string bounds accept the boundary and reject one over", (t) => {
  const cwd = createRepository(t);
  addWorkingCandidate(cwd);
  const result = runCompanion(cwd);
  assert.equal(result.status, 0, result.stderr);
  const schemaIndex = result.invocation.argv.indexOf("--json-schema");
  const schema = JSON.parse(result.invocation.argv[schemaIndex + 1]);
  const value = {
    verdict: "NO_MATERIAL_FINDINGS_STATIC",
    findings: [],
    confidence: 0.9,
    recommendation: "x".repeat(4096)
  };

  assert.doesNotThrow(() => runtime.validateJsonSchemaSubset(schema, value));
  value.recommendation += "x";
  assert.throws(
    () => runtime.validateJsonSchemaSubset(schema, value),
    (error) => error?.code === "INVALID_CLAUDE_RESULT"
  );
});

test("POSIX grounding keeps literal backslashes distinct from path separators", () => {
  assert.equal(typeof runtime.normalizeCandidatePath, "function");
  assert.equal(typeof runtime.findingIsGrounded, "function");

  const literalBackslash = runtime.normalizeCandidatePath("a\\b.js", "linux");
  const nestedPath = runtime.normalizeCandidatePath("a/b.js", "linux");
  assert.equal(literalBackslash, "a\\b.js");
  assert.equal(nestedPath, "a/b.js");
  assert.notEqual(literalBackslash, nestedPath);
  assert.equal(runtime.normalizeCandidatePath("a\\b.js", "win32"), "a/b.js");

  const groundings = new Map([
    [literalBackslash, { path: literalBackslash, currentLines: new Set([1]), deletedLines: new Set() }],
    [nestedPath, { path: nestedPath, currentLines: new Set([2]), deletedLines: new Set() }]
  ]);
  assert.equal(groundings.size, 2, "distinct POSIX candidates were aliased");
  assert.equal(
    runtime.findingIsGrounded(
      groundings,
      { file: "a/b.js", line_start: 1, line_end: 1 },
      "linux"
    ),
    false,
    "a nested-path finding used evidence from the literal-backslash file"
  );
  assert.equal(
    runtime.findingIsGrounded(
      groundings,
      { file: "a\\b.js", line_start: 1, line_end: 1 },
      "linux"
    ),
    true
  );
});

test("schema clone immediately controls structured output validation", (t) => {
  const cwd = createRepository(t);
  addWorkingCandidate(cwd);
  const result = runCompanion(cwd);
  assert.equal(result.status, 0, result.stderr);
  const schemaIndex = result.invocation.argv.indexOf("--json-schema");
  assert.notEqual(schemaIndex, -1);
  const schemaClone = JSON.parse(result.invocation.argv[schemaIndex + 1]);
  schemaClone.properties.verdict.enum = ["DIFFERENT_VERDICT"];

  assert.throws(
    () => runtime.validateJsonSchemaSubset(
      schemaClone,
      JSON.parse(result.stdout).result
    ),
    (error) => error?.code === "INVALID_CLAUDE_RESULT"
  );
});

function validMaterialResult() {
  return {
    verdict: "MATERIAL_FINDINGS",
    findings: [
      {
        severity: "high",
        title: "Candidate defect",
        evidence: "The transported candidate line demonstrates the defect.",
        claim: "The candidate violates the required invariant.",
        impact: "The operation can return an invalid result.",
        file: "candidate.js",
        line_start: 1,
        line_end: 1,
        inference: "direct",
        confidence: 0.91,
        recommendation: "Correct the candidate and rerun review."
      }
    ],
    confidence: 0.91,
    recommendation: "Resolve the finding and rerun review.",
    next_steps: ["Run the targeted regression."]
  };
}

test("schema contract rejects every structural result violation", async (t) => {
  const cwd = createRepository(t);
  addWorkingCandidate(cwd);
  const cases = [];
  for (const field of ["verdict", "findings", "confidence", "recommendation"]) {
    cases.push([`missing top-level ${field}`, (value) => {
      delete value[field];
      return value;
    }]);
  }
  for (const field of [
    "severity",
    "title",
    "evidence",
    "claim",
    "impact",
    "file",
    "line_start",
    "line_end",
    "inference",
    "confidence",
    "recommendation"
  ]) {
    cases.push([`missing finding ${field}`, (value) => {
      delete value.findings[0][field];
      return value;
    }]);
  }
  cases.push(
    ["non-object root", () => 7],
    ["non-object finding", (value) => {
      value.findings[0] = null;
      return value;
    }],
    ["non-array findings", (value) => {
      value.findings = {};
      return value;
    }],
    ["non-array next_steps", (value) => {
      value.next_steps = {};
      return value;
    }],
    ["unknown top-level key", (value) => {
      value.unknown = true;
      return value;
    }],
    ["unknown finding key", (value) => {
      value.findings[0].unknown = true;
      return value;
    }],
    ["unsupported verdict", (value) => {
      value.verdict = "APPROVED";
      return value;
    }],
    ["unsupported severity", (value) => {
      value.findings[0].severity = "low";
      return value;
    }],
    ["unsupported inference", (value) => {
      value.findings[0].inference = "guess";
      return value;
    }],
    ["empty recommendation", (value) => {
      value.recommendation = "";
      return value;
    }],
    ["empty summary", (value) => {
      value.summary = "";
      return value;
    }],
    ["empty next step", (value) => {
      value.next_steps = [""];
      return value;
    }],
    ["duplicate next steps", (value) => {
      value.next_steps = ["same", "same"];
      return value;
    }],
    ["top confidence below zero", (value) => {
      value.confidence = -0.01;
      return value;
    }],
    ["top confidence above one", (value) => {
      value.confidence = 1.01;
      return value;
    }],
    ["finding confidence below zero", (value) => {
      value.findings[0].confidence = -0.01;
      return value;
    }],
    ["finding confidence above one", (value) => {
      value.findings[0].confidence = 1.01;
      return value;
    }],
    ["material verdict without findings", (value) => {
      value.findings = [];
      return value;
    }],
    ["static verdict with a finding", (value) => {
      value.verdict = "NO_MATERIAL_FINDINGS_STATIC";
      return value;
    }]
  );
  for (const field of [
    "title",
    "evidence",
    "claim",
    "impact",
    "file",
    "recommendation"
  ]) {
    cases.push([`empty finding ${field}`, (value) => {
      value.findings[0][field] = "";
      return value;
    }]);
  }

  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const candidate = mutate(structuredClone(validMaterialResult()));
      const result = runCompanion(cwd, [], {
        env: { FAKE_CLAUDE_RESULT: JSON.stringify(candidate) }
      });
      assert.notEqual(result.status, 0, `${name} was accepted`);
      assert.match(`${result.stdout}\n${result.stderr}`, /INVALID_CLAUDE_RESULT/);
    });
  }
});

test("grounding contract rejects every invalid path and line range", async (t) => {
  const cwd = createRepository(t);
  addWorkingCandidate(cwd);
  const cases = [
    ["absolute path", (value) => {
      value.findings[0].file = "/candidate.js";
      return value;
    }],
    ["parent path", (value) => {
      value.findings[0].file = "../candidate.js";
      return value;
    }],
    ["NUL-bearing path", (value) => {
      value.findings[0].file = "candidate\0.js";
      return value;
    }],
    ["non-integer line_start", (value) => {
      value.findings[0].line_start = 0.5;
      return value;
    }],
    ["non-integer line_end", (value) => {
      value.findings[0].line_end = 1.5;
      return value;
    }],
    ["zero line_start", (value) => {
      value.findings[0].line_start = 0;
      return value;
    }],
    ["zero line_end", (value) => {
      value.findings[0].line_end = 0;
      return value;
    }],
    ["unsafe integer line_end", (value) => {
      value.findings[0].line_end = Number.MAX_SAFE_INTEGER + 1;
      return value;
    }],
    ["reversed line range", (value) => {
      value.findings[0].line_start = 2;
      value.findings[0].line_end = 1;
      return value;
    }],
    ["untransported line", (value) => {
      value.findings[0].line_start = 2;
      value.findings[0].line_end = 2;
      return value;
    }]
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const candidate = mutate(structuredClone(validMaterialResult()));
      const result = runCompanion(cwd, [], {
        env: { FAKE_CLAUDE_RESULT: JSON.stringify(candidate) }
      });
      assert.notEqual(result.status, 0, `${name} was accepted`);
      assert.match(`${result.stdout}\n${result.stderr}`, /INVALID_CLAUDE_RESULT/);
    });
  }
});

function runClaudeResultFile(t, cwd, value, timeoutMs = 20_000) {
  const stateDirectory = makeTempDirectory(t, "bounded-claude-result-");
  const resultPath = join(stateDirectory, "result.json");
  writeText(resultPath, JSON.stringify(value));
  return runCompanion(cwd, [], {
    timeoutMs,
    env: { FAKE_CLAUDE_RESULT_FILE: resultPath }
  });
}

test("accepts the bounded findings-count and citation-span limits", (t) => {
  const cwd = createRepository(t);
  const file = "dense.js";
  writeText(
    join(cwd, file),
    Array.from({ length: 200 }, (_value, index) => `before ${index + 1}`).join("\n") + "\n"
  );
  git(cwd, "add", file);
  git(cwd, "commit", "-m", "add dense candidate");
  writeText(
    join(cwd, file),
    Array.from({ length: 200 }, (_value, index) => `after ${index + 1}`).join("\n") + "\n"
  );
  const resultValue = validMaterialResult();
  resultValue.findings = Array.from({ length: 100 }, () => completeFinding({
    file,
    line_start: 1,
    line_end: 200
  }));

  const result = runClaudeResultFile(t, cwd, resultValue);

  assert.equal(result.status, 0, result.stderr);
});

test("rejects findings above the bounded count and citation-span limits", async (t) => {
  const cwd = createRepository(t);
  const file = "dense.js";
  writeText(
    join(cwd, file),
    Array.from({ length: 201 }, (_value, index) => `before ${index + 1}`).join("\n") + "\n"
  );
  git(cwd, "add", file);
  git(cwd, "commit", "-m", "add dense candidate");
  writeText(
    join(cwd, file),
    Array.from({ length: 201 }, (_value, index) => `after ${index + 1}`).join("\n") + "\n"
  );
  const cases = [
    ["finding count", 101, 1],
    ["citation span", 1, 201]
  ];

  for (const [name, count, lineEnd] of cases) {
    await t.test(name, () => {
      const resultValue = validMaterialResult();
      resultValue.findings = Array.from({ length: count }, () => completeFinding({
        file,
        line_start: 1,
        line_end: lineEnd
      }));
      const result = runClaudeResultFile(t, cwd, resultValue);
      assert.notEqual(result.status, 0, `${name} was accepted`);
      assert.match(`${result.stdout || ""}\n${result.stderr || ""}`, /INVALID_CLAUDE_RESULT/);
    });
  }
});

test("rejects a maximal validation-amplification result before the outer deadline", (t) => {
  const cwd = createRepository(t);
  const file = "amplification.js";
  const lineCount = 100_000;
  writeText(join(cwd, file), "\n".repeat(lineCount));
  git(cwd, "add", file);
  git(cwd, "commit", "-m", "add amplification candidate");
  writeText(join(cwd, file), "x\n".repeat(lineCount));
  const resultValue = validMaterialResult();
  resultValue.findings = Array.from({ length: 2_000 }, () => completeFinding({
    file,
    line_start: 1,
    line_end: lineCount
  }));

  const result = runClaudeResultFile(t, cwd, resultValue, 4_000);

  assert.equal(result.error, undefined, result.error?.message);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /INVALID_CLAUDE_RESULT/);
});

test("collects staged, unstaged, and untracked content without changing Git state", (t) => {
  const cwd = createRepository(t);
  writeText(join(cwd, "staged.txt"), "STAGED_CHANGE_SENTINEL\n");
  git(cwd, "add", "staged.txt");
  writeText(join(cwd, "unstaged.txt"), "UNSTAGED_CHANGE_SENTINEL\n");
  writeText(join(cwd, "new-file.txt"), "UNTRACKED_CHANGE_SENTINEL\n");

  const before = snapshotRepository(cwd);
  const logDirectory = makeTempDirectory(t, "fake-claude-log-");
  const result = runCompanion(cwd, [], {
    logPath: join(logDirectory, "invocation.json")
  });
  const after = snapshotRepository(cwd);

  assert.equal(result.status, 0, result.stderr);
  const invocation = result.invocation;
  assert.match(invocation.stdin, /STAGED_CHANGE_SENTINEL/);
  assert.match(invocation.stdin, /UNSTAGED_CHANGE_SENTINEL/);
  assert.match(invocation.stdin, /UNTRACKED_CHANGE_SENTINEL/);
  assert.match(invocation.stdin, /staged/i);
  assert.match(invocation.stdin, /unstaged/i);
  assert.match(invocation.stdin, /untracked/i);
  assert.deepEqual(after, before);
  assert.equal(readFileSync(join(cwd, "new-file.txt"), "utf8"), "UNTRACKED_CHANGE_SENTINEL\n");
});

test("accepts a valid Claude event stream and returns its final structured result", (t) => {
  const cwd = createRepository(t);
  addWorkingCandidate(cwd);

  const result = runCompanion(cwd, [], {
    env: { FAKE_CLAUDE_STREAM: "1" }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    JSON.parse(result.stdout).result.verdict,
    "NO_MATERIAL_FINDINGS_STATIC"
  );
});

test("live probe verdict uses exact system Task telemetry correlation", () => {
  const events = [
    {
      type: "system",
      subtype: "init",
      tools: ["StructuredOutput", "Task"],
      agents: {
        "lead-reviewer": {},
        "correctness-reviewer": {},
        "scope-reviewer": {}
      }
    },
    { type: "system", subtype: "task_started", task_id: "task-1", tool_use_id: "tool-1", subagent_type: "correctness-reviewer" },
    { type: "system", subtype: "task_started", task_id: "task-2", tool_use_id: "tool-2", subagent_type: "scope-reviewer" },
    { type: "system", subtype: "task_notification", task_id: "task-1", tool_use_id: "tool-1", status: "succeeded" },
    { type: "system", subtype: "task_notification", task_id: "task-2", tool_use_id: "tool-2", status: "succeeded" },
    { type: "result", subtype: "success", is_error: false, structured_output: { ok: true } }
  ];
  const encode = (values) => values.map((event) => JSON.stringify(event)).join("\n");

  const exact = observeClaudeStream(encode(events));
  assert.equal(probeContractIsSatisfied(exact), true);

  const mismatched = structuredClone(events);
  mismatched[3].tool_use_id = "wrong-tool";
  assert.equal(
    probeContractIsSatisfied(observeClaudeStream(encode(mismatched))),
    false
  );
});

test("live probe rejects init and stderr contract failures", async (t) => {
  const init = {
    type: "system",
    subtype: "init",
    tools: ["StructuredOutput", "Task"],
    agents: {
      "lead-reviewer": {},
      "correctness-reviewer": {},
      "scope-reviewer": {}
    }
  };
  const telemetry = [
    { type: "system", subtype: "task_started", task_id: "task-1", tool_use_id: "tool-1", subagent_type: "correctness-reviewer" },
    { type: "system", subtype: "task_started", task_id: "task-2", tool_use_id: "tool-2", subagent_type: "scope-reviewer" },
    { type: "system", subtype: "task_notification", task_id: "task-1", tool_use_id: "tool-1", status: "succeeded" },
    { type: "system", subtype: "task_notification", task_id: "task-2", tool_use_id: "tool-2", status: "succeeded" },
    { type: "result", subtype: "success", is_error: false, structured_output: { ok: true } }
  ];
  const encode = (events) => events.map((event) => JSON.stringify(event)).join("\n");
  const cases = [
    ["missing init", telemetry, ""],
    ["missing expected init tool", [{ ...init, tools: ["StructuredOutput"] }, ...telemetry], ""],
    ["unexpected init tool", [{ ...init, tools: ["StructuredOutput", "Task", "Agent"] }, ...telemetry], ""],
    ["missing correctness reviewer", [{ ...init, agents: { "lead-reviewer": {}, "scope-reviewer": {} } }, ...telemetry], ""],
    ["missing scope reviewer", [{ ...init, agents: { "lead-reviewer": {}, "correctness-reviewer": {} } }, ...telemetry], ""],
    ["schema rejection", [init, ...telemetry], "Structured output schema rejected"],
    ["unknown tool", [init, ...telemetry], "Unknown tool requested"],
    ["unknown agent", [init, ...telemetry], "Unknown agent requested"]
  ];
  for (const [name, events, stderr] of cases) {
    await t.test(name, () => {
      assert.equal(
        probeContractIsSatisfied(observeClaudeStream(encode(events), stderr)),
        false
      );
    });
  }
});

test("live probe cleans an observed descendant on every post-spawn failure path", async (t) => {
  const cases = [
    ["nonzero normal close", { outcome: { kind: "close", status: 7 }, stdout: "" }],
    ["malformed stream", { outcome: { kind: "close", status: 0 }, stdout: "{not-json}\n" }],
    [
      "contract rejection",
      {
        outcome: { kind: "close", status: 0 },
        stdout: `${JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: { ok: true } })}\n`
      }
    ]
  ];
  for (const [name, scenario] of cases) {
    await t.test(name, async () => {
      let descendantAlive = true;
      let cleanupCount = 0;
      let observerStopCount = 0;
      const observer = {
        attach(child) {
          child.syntheticObservedDescendant = true;
        },
        async stop() {
          observerStopCount += 1;
        }
      };
      await assert.rejects(() => liveProbe.runLiveProbe({
        spawnFn: () => ({ pid: 101 }),
        startProcessTreeObserverFn: async () => observer,
        monitorClaudeProcessFn: async () => ({
          outcome: scenario.outcome,
          stdoutChunks: [Buffer.from(scenario.stdout)],
          stderrChunks: []
        }),
        terminateProcessTreeFn: async (child) => {
          assert.equal(child.syntheticObservedDescendant, true);
          cleanupCount += 1;
          descendantAlive = false;
          await observer.stop();
        },
        writeSummaryFn: () => {}
      }));
      assert.equal(descendantAlive, false, "observed descendant survived failure cleanup");
      assert.equal(cleanupCount, 1, "cleanup was not exactly once");
      assert.equal(observerStopCount, 1, "observer was not stopped exactly once");
    });
  }
});

test("live probe reuses timeout cleanup and does not clean a successful process", async (t) => {
  const validStream = [
    { type: "system", subtype: "init", tools: ["StructuredOutput", "Task"], agents: { "lead-reviewer": {}, "correctness-reviewer": {}, "scope-reviewer": {} } },
    { type: "system", subtype: "task_started", task_id: "task-1", tool_use_id: "tool-1", subagent_type: "correctness-reviewer" },
    { type: "system", subtype: "task_started", task_id: "task-2", tool_use_id: "tool-2", subagent_type: "scope-reviewer" },
    { type: "system", subtype: "task_notification", task_id: "task-1", tool_use_id: "tool-1", status: "succeeded" },
    { type: "system", subtype: "task_notification", task_id: "task-2", tool_use_id: "tool-2", status: "succeeded" },
    { type: "result", subtype: "success", is_error: false, structured_output: { ok: true } }
  ].map((event) => JSON.stringify(event)).join("\n");
  const createHarness = () => {
    let cleanupCount = 0;
    let stopCount = 0;
    const observer = {
      attach() {},
      async stop() { stopCount += 1; }
    };
    return {
      observer,
      counts: () => ({ cleanupCount, stopCount }),
      dependencies: {
        spawnFn: () => ({ pid: 102 }),
        startProcessTreeObserverFn: async () => observer,
        terminateProcessTreeFn: async () => {
          cleanupCount += 1;
          await observer.stop();
        },
        writeSummaryFn: () => {}
      }
    };
  };

  await t.test("timeout cleanup remains exactly once", async () => {
    const harness = createHarness();
    await assert.rejects(() => liveProbe.runLiveProbe({
      ...harness.dependencies,
      monitorClaudeProcessFn: async (child, prompt, options) => {
        await options.terminateProcessTreeFn(child);
        throw new Error("synthetic timeout");
      }
    }), /synthetic timeout/);
    assert.deepEqual(harness.counts(), { cleanupCount: 1, stopCount: 1 });
  });

  await t.test("success stops observation without force cleanup", async () => {
    const harness = createHarness();
    await liveProbe.runLiveProbe({
      ...harness.dependencies,
      monitorClaudeProcessFn: async () => ({
        outcome: { kind: "close", status: 0 },
        stdoutChunks: [Buffer.from(validStream)],
        stderrChunks: []
      })
    });
    assert.deepEqual(harness.counts(), { cleanupCount: 0, stopCount: 1 });
  });
});

test("live probe surfaces cleanup failure over the triggering failure", async () => {
  const cleanupFailure = Object.assign(new Error("synthetic cleanup failure"), {
    code: "PROCESS_CLEANUP_FAILED"
  });
  let cleanupCount = 0;
  let observerStopCount = 0;
  const observer = {
    attach() {},
    async stop() { observerStopCount += 1; }
  };
  await assert.rejects(
    () => liveProbe.runLiveProbe({
      spawnFn: () => ({ pid: 103 }),
      startProcessTreeObserverFn: async () => observer,
      monitorClaudeProcessFn: async () => ({
        outcome: { kind: "close", status: 9 },
        stdoutChunks: [],
        stderrChunks: []
      }),
      terminateProcessTreeFn: async () => {
        cleanupCount += 1;
        throw cleanupFailure;
      },
      writeSummaryFn: () => {}
    }),
    (error) => error === cleanupFailure
  );
  assert.equal(cleanupCount, 1);
  assert.equal(observerStopCount, 1);
});

test("production and live probe share task notification success contract", async (t) => {
  const cases = [
    ["observed completed status", "completed", { is_error: false }, true],
    ["legacy succeeded status", "succeeded", { is_error: false }, true],
    ["success alias", "success", { is_error: false }, false],
    ["failed status", "failed", { is_error: false }, false],
    ["error status", "error", { is_error: false }, false],
    ["completed status marked as error", "completed", { is_error: true }, false],
    ["succeeded status marked as error", "succeeded", { is_error: true }, false],
    ["completed status with error payload", "completed", { is_error: false, error: { kind: "synthetic" } }, false],
    ["succeeded status with error payload", "succeeded", { is_error: false, error: { kind: "synthetic" } }, false]
  ];
  for (const [name, status, notificationFields, accepted] of cases) {
    await t.test(name, (subtest) => {
      const cwd = createRepository(subtest);
      addWorkingCandidate(cwd);
      const events = [
        {
          type: "system",
          subtype: "init",
          tools: ["StructuredOutput", "Task"],
          agents: {
            "lead-reviewer": {},
            "correctness-reviewer": {},
            "scope-reviewer": {}
          }
        },
        { type: "system", subtype: "task_started", task_id: "task-1", tool_use_id: "tool-1", subagent_type: "correctness-reviewer" },
        { type: "system", subtype: "task_started", task_id: "task-2", tool_use_id: "tool-2", subagent_type: "scope-reviewer" },
        { type: "system", subtype: "task_notification", task_id: "task-1", tool_use_id: "tool-1", status, ...notificationFields },
        { type: "system", subtype: "task_notification", task_id: "task-2", tool_use_id: "tool-2", status, ...notificationFields },
        {
          type: "result",
          subtype: "success",
          is_error: false,
          structured_output: {
            verdict: "NO_MATERIAL_FINDINGS_STATIC",
            findings: [],
            confidence: 0.91,
            recommendation: "Continue required verification."
          }
        }
      ];
      const encoded = events.map((event) => JSON.stringify(event)).join("\n");
      const production = runCompanion(cwd, [], {
        env: { FAKE_CLAUDE_RAW_OUTPUT: encoded }
      });
      assert.deepEqual(
        {
          probe: probeContractIsSatisfied(observeClaudeStream(encoded)),
          production: production.status === 0
        },
        { probe: accepted, production: accepted }
      );
      if (!accepted) {
        assert.match(`${production.stdout}\n${production.stderr}`, /CLAUDE_DELEGATION_INCOMPLETE/);
      }
    });
  }
});

test("live probe rejects status aliases and invalid final results", async (t) => {
  const telemetry = [
    {
      type: "system",
      subtype: "init",
      tools: ["StructuredOutput", "Task"],
      agents: {
        "lead-reviewer": {},
        "correctness-reviewer": {},
        "scope-reviewer": {}
      }
    },
    { type: "system", subtype: "task_started", task_id: "task-1", tool_use_id: "tool-1", subagent_type: "correctness-reviewer" },
    { type: "system", subtype: "task_started", task_id: "task-2", tool_use_id: "tool-2", subagent_type: "scope-reviewer" },
    { type: "system", subtype: "task_notification", task_id: "task-1", tool_use_id: "tool-1", status: "succeeded" },
    { type: "system", subtype: "task_notification", task_id: "task-2", tool_use_id: "tool-2", status: "succeeded" }
  ];
  const result = {
    type: "result",
    subtype: "success",
    is_error: false,
    structured_output: { ok: true }
  };
  const encode = (events) => events.map((event) => JSON.stringify(event)).join("\n");
  const alias = (status) => [
    telemetry[0],
    telemetry[1],
    telemetry[2],
    { ...telemetry[3], status },
    telemetry[4],
    result
  ];
  const withMatchingIdentity = (reviewer, field, value) =>
    telemetry.map((event) => {
      if (
        event.subtype !== "task_started" &&
        event.subtype !== "task_notification"
      ) {
        return event;
      }
      const eventReviewer = event.subtype === "task_started"
        ? event.subagent_type
        : telemetry.find(
          (candidate) =>
            candidate.subtype === "task_started" &&
            candidate.task_id === event.task_id &&
            candidate.tool_use_id === event.tool_use_id
        )?.subagent_type;
      return eventReviewer === reviewer ? { ...event, [field]: value } : event;
    });
  for (const [name, events] of [
    ["success notification alias", alias("success")],
    ["error result carrying structured output", [...telemetry, { ...result, subtype: "error", is_error: true }]],
    ["duplicate final result", [...telemetry, result, result]],
    ["missing final result", telemetry],
    ["notification before matching start", [telemetry[0], telemetry[3], telemetry[1], telemetry[2], telemetry[4], result]],
    ["final result before completions", [telemetry[0], telemetry[1], telemetry[2], result, telemetry[3], telemetry[4]]],
    ["event after final result", [...telemetry, result, { type: "rate_limit_event", rate_limit_info: {} }]],
    ["unsuccessful final subtype", [...telemetry, { ...result, subtype: "error" }]],
    ["final result marked as error", [...telemetry, { ...result, is_error: true }]],
    ["empty task id", [...withMatchingIdentity("correctness-reviewer", "task_id", ""), result]],
    ["blank task id", [...withMatchingIdentity("correctness-reviewer", "task_id", "  "), result]],
    ["empty tool-use id", [...withMatchingIdentity("scope-reviewer", "tool_use_id", ""), result]],
    ["blank tool-use id", [...withMatchingIdentity("scope-reviewer", "tool_use_id", "\t"), result]]
  ]) {
    await t.test(name, () => {
      assert.equal(
        probeContractIsSatisfied(observeClaudeStream(encode(events))),
        false
      );
    });
  }
});

test("rejects malformed or incomplete Claude event streams", async (t) => {
  const validTelemetry = [
    { type: "system", subtype: "task_started", task_id: "task-1", tool_use_id: "tool-1", subagent_type: "correctness-reviewer" },
    { type: "system", subtype: "task_started", task_id: "task-2", tool_use_id: "tool-2", subagent_type: "scope-reviewer" },
    { type: "system", subtype: "task_notification", task_id: "task-1", tool_use_id: "tool-1", status: "succeeded" },
    { type: "system", subtype: "task_notification", task_id: "task-2", tool_use_id: "tool-2", status: "succeeded" }
  ];
  const encodeEvents = (...events) =>
    [...validTelemetry, ...events].map((event) => JSON.stringify(event)).join("\n") + "\n";
  const validResult = {
    type: "result",
    subtype: "success",
    is_error: false,
    structured_output: {
      verdict: "NO_MATERIAL_FINDINGS_STATIC",
      findings: [],
      confidence: 0.91,
      recommendation: "Continue required verification."
    }
  };
  for (const [name, output, code] of [
    ["malformed event", "{not-json}\n", "INVALID_CLAUDE_RESULT"],
    ["non-object event", "[]\n", "INVALID_CLAUDE_RESULT"],
    ["missing result", encodeEvents(), "INVALID_CLAUDE_RESULT"],
    [
      "multiple result events",
      encodeEvents(validResult, validResult),
      "INVALID_CLAUDE_RESULT"
    ],
    [
      "unsuccessful result",
      encodeEvents({ ...validResult, subtype: "error", is_error: true }),
      "CLAUDE_FAILED"
    ],
    [
      "missing structured result",
      encodeEvents({ type: "result", subtype: "success", is_error: false }),
      "INVALID_CLAUDE_RESULT"
    ]
  ]) {
    await t.test(name, () => {
      const cwd = createRepository(t);
      addWorkingCandidate(cwd);
      const result = runCompanion(cwd, [], {
        env: { FAKE_CLAUDE_RAW_OUTPUT: output }
      });
      assert.notEqual(result.status, 0);
      assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(code));
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /SyntaxError/);
    });
  }
});

test("--base reviews the merge-base range <base>...HEAD", (t) => {
  const cwd = createRepository(t);
  const rootCommit = git(cwd, "rev-parse", "HEAD");

  git(cwd, "switch", "-c", "feature");
  writeText(join(cwd, "feature-only.txt"), "FEATURE_RANGE_SENTINEL\n");
  git(cwd, "add", "feature-only.txt");
  git(cwd, "commit", "-m", "feature change");

  git(cwd, "switch", "-c", "review-base", rootCommit);
  writeText(join(cwd, "base-only.txt"), "BASE_BRANCH_SENTINEL\n");
  git(cwd, "add", "base-only.txt");
  git(cwd, "commit", "-m", "base branch change");
  git(cwd, "switch", "feature");
  const featureCommit = git(cwd, "rev-parse", "HEAD");

  const result = runCompanion(cwd, ["--base", "review-base"]);

  assert.equal(result.status, 0, result.stderr);
  const invocation = result.invocation;
  assert.match(invocation.stdin, /FEATURE_RANGE_SENTINEL/);
  assert.doesNotMatch(invocation.stdin, /BASE_BRANCH_SENTINEL/);
  const reviewBaseCommit = git(cwd, "rev-parse", "review-base");
  assert.match(invocation.stdin, new RegExp(`${reviewBaseCommit}\\.\\.\\.${featureCommit}`));
  assert.doesNotMatch(invocation.stdin, /review-base\.\.\.HEAD/);
});

test("rejects an invalid --base before invoking Claude", (t) => {
  const cwd = createRepository(t);
  const logPath = join(cwd, "claude-must-not-run.json");

  const result = runCompanion(cwd, ["--base", "definitely-not-a-ref"], { logPath });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /invalid base ref/i);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /definitely-not-a-ref/i);
  assert.equal(existsSync(logPath), false, "Claude was invoked for an invalid base");
});

test("rejects an empty working-tree candidate before invoking Claude", (t) => {
  const cwd = createRepository(t);
  const logDirectory = makeTempDirectory(t, "empty-candidate-log-");
  const logPath = join(logDirectory, "invocation.json");

  const result = runCompanion(cwd, [], { logPath });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /EMPTY_CANDIDATE|no candidate/i);
  assert.equal(existsSync(logPath), false);
});

test("sends the review prompt over stdin and invokes Claude in isolated read-only structured mode", (t) => {
  const cwd = createRepository(t);
  const promptSentinel = "PROMPT_MUST_NOT_APPEAR_IN_ARGV";
  const focus = "FOCUS_MUST_REACH_CLAUDE_ONLY_THROUGH_STDIN";
  writeText(join(cwd, "untracked-prompt.txt"), `${promptSentinel}\n`);

  const result = runCompanion(cwd, [focus]);

  const invocation = result.invocation;
  assert.match(invocation.stdin, new RegExp(promptSentinel));
  assert.match(invocation.stdin, new RegExp(focus));
  assert.equal(invocation.argv.some((arg) => arg.includes(promptSentinel)), false);
  assert.equal(invocation.argv.some((arg) => arg.includes(focus)), false);

  const valueAfter = (flag) => {
    const index = invocation.argv.indexOf(flag);
    assert.notEqual(index, -1, `missing Claude flag ${flag}`);
    assert.ok(index + 1 < invocation.argv.length, `missing value for Claude flag ${flag}`);
    return invocation.argv[index + 1];
  };

  assert.ok(invocation.argv.includes("--print"));
  assert.ok(invocation.argv.includes("--strict-mcp-config"));
  assert.ok(invocation.argv.includes("--no-chrome"));
  assert.ok(invocation.argv.includes("--disable-slash-commands"));
  assert.ok(invocation.argv.includes("--no-session-persistence"));
  assert.equal(valueAfter("--input-format"), "text");
  assert.equal(valueAfter("--output-format"), "stream-json");
  assert.ok(invocation.argv.includes("--verbose"));
  assert.equal(valueAfter("--permission-mode"), "plan");

  const expectedLeadTools = "Agent(correctness-reviewer,scope-reviewer)";
  assert.equal(valueAfter("--tools"), "Agent");
  assert.equal(valueAfter("--allowedTools"), expectedLeadTools);
  assert.deepEqual(JSON.parse(valueAfter("--mcp-config")), { mcpServers: {} });

  const agents = JSON.parse(valueAfter("--agents"));
  assert.ok(Object.keys(agents).length > 0, "--agents must define at least one reviewer");
  assert.ok(valueAfter("--agent") in agents, "--agent must select one of the supplied agents");
  for (const childName of ["correctness-reviewer", "scope-reviewer"]) {
    assert.deepEqual(
      agents[childName]?.tools,
      [],
      `${childName} must have no repository tools`
    );
    assert.equal(
      agents[childName]?.permissionMode,
      "plan",
      `${childName} must use plan permission mode`
    );
  }
  assert.deepEqual(agents["lead-reviewer"].tools, [
    expectedLeadTools,
    "StructuredOutput"
  ]);

  const schema = JSON.parse(valueAfter("--json-schema"));
  const bundledSchema = JSON.parse(readFileSync(join(
    projectRoot,
    "plugins",
    "claude-adversarial-review",
    "schemas",
    "review-output.schema.json"
  ), "utf8"));
  assert.deepEqual(schema, bundledSchema);
  assert.equal(Object.hasOwn(schema, "oneOf"), false);
  assert.deepEqual(
    new Set(schema.required),
    new Set(["verdict", "findings", "confidence", "recommendation"])
  );
  assert.equal(schema.properties.verdict.type, "string");
  assert.deepEqual(schema.properties.verdict.enum, [
    "MATERIAL_FINDINGS",
    "NO_MATERIAL_FINDINGS_STATIC"
  ]);
  assert.equal(schema.properties.findings.type, "array");
  assert.equal(
    schema.properties.findings.items.$ref,
    "#/definitions/finding"
  );
  const findingSchema = schema.definitions.finding;
  assert.deepEqual(
    new Set(findingSchema.required),
    new Set([
      "severity",
      "title",
      "evidence",
      "claim",
      "impact",
      "file",
      "line_start",
      "line_end",
      "inference",
      "confidence",
      "recommendation"
    ])
  );
  assert.equal(
    schema.properties.confidence.$ref,
    "#/definitions/confidence"
  );
  const confidenceSchema = schema.definitions.confidence;
  assert.ok(["number", "integer"].includes(confidenceSchema.type));
  assert.equal(schema.properties.recommendation.type, "string");
});

test("does not expand placeholder text supplied as review focus", (t) => {
  const cwd = createRepository(t);
  addWorkingCandidate(cwd, "PROMPT_INTERPOLATION_CANDIDATE\n");

  const result = runCompanion(cwd, ["{{REVIEW_INPUT}}"]);

  assert.equal(result.status, 0, result.stderr);
  const prompt = result.invocation.stdin;
  assert.equal(
    (prompt.match(/^BEGIN_UNTRUSTED_REPOSITORY_EVIDENCE_[0-9a-f]{32}$/gm) || []).length,
    1
  );
  assert.equal(
    (prompt.match(/^END_UNTRUSTED_REPOSITORY_EVIDENCE_[0-9a-f]{32}$/gm) || []).length,
    1
  );
  assert.equal((prompt.match(/E\|PROMPT_INTERPOLATION_CANDIDATE/g) || []).length, 1);
});

test("requires every exact prompt placeholder exactly once", async (t) => {
  assert.equal(typeof runtime.interpolatePromptTemplate, "function");
  const replacements = {
    TARGET_LABEL: "target",
    USER_FOCUS: "focus",
    REVIEW_COLLECTION_GUIDANCE: "guidance",
    REVIEW_INPUT: "evidence"
  };
  const valid = Object.keys(replacements)
    .map((name) => `{{${name}}}`)
    .join("\n");

  for (const [name, template] of [
    ["missing", valid.replace("{{REVIEW_INPUT}}", "")],
    ["duplicate", `${valid}\n{{REVIEW_INPUT}}`]
  ]) {
    await t.test(name, () => {
      assert.throws(
        () => runtime.interpolatePromptTemplate(template, replacements),
        (error) => error?.code === "INVALID_PROMPT"
      );
    });
  }
});

test("fails visibly when Claude returns malformed output", (t) => {
  const cwd = createRepository(t);
  addWorkingCandidate(cwd);

  const result = runCompanion(cwd, [], {
    env: { FAKE_CLAUDE_OUTPUT: "malformed" }
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Claude.*(malformed|invalid|JSON)|parse/i);
});

test("preserves evidence-oriented verdict and grounded findings in JSON output", (t) => {
  const cwd = createRepository(t);
  writeText(
    join(cwd, "src", "unsafe.js"),
    `${Array.from({ length: 44 }, (_, index) => `line ${index + 1}`).join("\n")}\n`
  );
  const expected = {
    verdict: "MATERIAL_FINDINGS",
    findings: [
      completeFinding({
        severity: "critical",
        title: "Do not ship",
        evidence: "The unchecked call at this location can delete unrelated records.",
        claim: "The delete operation is not restricted to the requested record.",
        impact: "Unrelated records can be permanently deleted.",
        file: "src/unsafe.js",
        line_start: 42,
        line_end: 44,
        confidence: 0.97,
        recommendation: "Constrain the delete predicate to the requested record."
      })
    ],
    confidence: 0.97,
    recommendation: "Resolve the critical finding and rerun review."
  };

  const result = runCompanion(cwd, [], {
    env: { FAKE_CLAUDE_RESULT: JSON.stringify(expected) }
  });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.result, expected);
});

test("accepts the static no-material-findings verdict only with no findings", (t) => {
  const cwd = createRepository(t);
  addWorkingCandidate(cwd);
  const expected = {
    verdict: "NO_MATERIAL_FINDINGS_STATIC",
    findings: [],
    confidence: 0.88,
    recommendation: "Treat this as static evidence and continue required verification."
  };

  const result = runCompanion(cwd, [], {
    env: { FAKE_CLAUDE_RESULT: JSON.stringify(expected) }
  });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.result, expected);
});

test("rejects findings missing any required grounding field", (t) => {
  const cwd = createRepository(t);
  addWorkingCandidate(cwd);
  const logDirectory = makeTempDirectory(t, "missing-finding-field-");
  const requiredFields = [
    "severity",
    "title",
    "evidence",
    "claim",
    "impact",
    "file",
    "line_start",
    "line_end",
    "inference",
    "confidence",
    "recommendation"
  ];

  for (const field of requiredFields) {
    const finding = completeFinding();
    delete finding[field];
    const result = runCompanion(cwd, [], {
      logPath: join(logDirectory, `missing-${field}.json`),
      env: {
        FAKE_CLAUDE_RESULT: JSON.stringify({
          verdict: "MATERIAL_FINDINGS",
          findings: [finding],
          confidence: 0.91,
          recommendation: "Resolve the finding and rerun review."
        })
      }
    });

    assert.notEqual(result.status, 0, `missing ${field} must be rejected`);
    assert.doesNotMatch(
      `${result.stdout}\n${result.stderr}`,
      /unsupported verdict/i,
      `missing ${field} must reach finding validation`
    );
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /INVALID_CLAUDE_RESULT/,
      `missing ${field} must return a validation diagnostic`
    );
  }
});

test("rejects a finding whose line_end precedes line_start", (t) => {
  const cwd = createRepository(t);
  addWorkingCandidate(cwd);
  const result = runCompanion(cwd, [], {
    env: {
      FAKE_CLAUDE_RESULT: JSON.stringify({
        verdict: "MATERIAL_FINDINGS",
        findings: [completeFinding({ line_start: 12, line_end: 11 })],
        confidence: 0.91,
        recommendation: "Resolve the finding and rerun review."
      })
    }
  });

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /unsupported verdict/i,
    "the reversed line range must reach finding validation"
  );
  assert.match(`${result.stdout}\n${result.stderr}`, /line_start|line_end|line range/i);
});
