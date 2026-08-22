import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

const expectedLeadTools = "Agent(correctness-reviewer,scope-reviewer)";
const expectedAgents = {
  "lead-reviewer": {
    description: "Leads a bounded adversarial review and returns the final structured verdict.",
    prompt: [
      "You are the lead adversarial code reviewer.",
      "Review only the candidate state and focus supplied in the user message.",
      "You must invoke correctness-reviewer exactly once and scope-reviewer exactly once using Agent, with one distinct attack surface per reviewer.",
      "Use only those configured subagents. Pass each reviewer only the relevant E| evidence lines, target, and focus from the supplied bounded evidence. Do not inspect the repository, modify files, or run commands.",
      "Look for concrete correctness, security, concurrency, retry, and scope failures.",
      "Return only output that satisfies the supplied JSON schema."
    ].join(" "),
    tools: [expectedLeadTools, "StructuredOutput"],
    permissionMode: "plan"
  },
  "correctness-reviewer": {
    description: "Looks for concrete correctness, state, and failure-path defects.",
    prompt: "Review only the bounded evidence included in your delegated task. You have no repository access or tools. Find concrete correctness defects grounded in that evidence.",
    tools: [],
    permissionMode: "plan"
  },
  "scope-reviewer": {
    description: "Checks scope isolation, security boundaries, and accidental unrelated impact.",
    prompt: "Review only the bounded evidence included in your delegated task. You have no repository access or tools. Check boundary and isolation failures grounded in that evidence.",
    tools: [],
    permissionMode: "plan"
  }
};
const expectedSchema = JSON.parse(readFileSync(join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "plugins",
  "claude-adversarial-review",
  "schemas",
  "review-output.schema.json"
), "utf8"));

const stdinChunks = [];
for await (const chunk of process.stdin) {
  stdinChunks.push(chunk);
}

const invocation = {
  argv: process.argv.slice(2),
  stdin: Buffer.concat(stdinChunks).toString("utf8")
};

if (process.env.FAKE_CLAUDE_LOG) {
  writeFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify(invocation, null, 2));
}

function requiredFlagValue(flag) {
  const positions = invocation.argv
    .map((value, index) => value === flag ? index : -1)
    .filter((index) => index !== -1);
  if (positions.length !== 1 || positions[0] + 1 >= invocation.argv.length) {
    return undefined;
  }
  return invocation.argv[positions[0] + 1];
}

function parseRequiredJsonFlag(flag) {
  const encoded = requiredFlagValue(flag);
  if (encoded === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(encoded);
  } catch {
    return undefined;
  }
}

const argvContractIsValid =
  requiredFlagValue("--tools") === "Agent" &&
  requiredFlagValue("--allowedTools") === expectedLeadTools &&
  requiredFlagValue("--agent") === "lead-reviewer" &&
  isDeepStrictEqual(parseRequiredJsonFlag("--agents"), expectedAgents) &&
  isDeepStrictEqual(parseRequiredJsonFlag("--json-schema"), expectedSchema);
if (!argvContractIsValid) {
  process.stderr.write(
    "FAKE_CLAUDE_INVALID_ARGV: required production Claude argument contract mismatch.\n"
  );
  process.exit(64);
}

if (process.env.FAKE_CLAUDE_STDERR) {
  process.stderr.write(process.env.FAKE_CLAUDE_STDERR);
}

if (process.env.FAKE_CLAUDE_RAW_OUTPUT !== undefined) {
  process.stdout.write(process.env.FAKE_CLAUDE_RAW_OUTPUT);
  process.exit(0);
}

if (process.env.FAKE_CLAUDE_OUTPUT === "malformed") {
  process.stdout.write("this is not Claude JSON");
  process.exit(0);
}

const structuredOutput = process.env.FAKE_CLAUDE_RESULT_FILE
  ? JSON.parse(readFileSync(process.env.FAKE_CLAUDE_RESULT_FILE, "utf8"))
  : process.env.FAKE_CLAUDE_RESULT
    ? JSON.parse(process.env.FAKE_CLAUDE_RESULT)
  : {
      verdict: "NO_MATERIAL_FINDINGS_STATIC",
      findings: [],
      confidence: 0.91,
      recommendation: "Continue required verification."
    };

function writeEvent(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function writeResultEvent() {
  writeEvent({
    type: "result",
    subtype: "success",
    is_error: false,
    structured_output: structuredOutput
  });
}

if (process.env.FAKE_CLAUDE_STREAM !== "0") {
  writeEvent({
    type: "system",
    subtype: "init",
    tools: ["StructuredOutput", "Task"],
    agents: {
      "lead-reviewer": {},
      "correctness-reviewer": {},
      "scope-reviewer": {}
    }
  });
  writeEvent({ type: "rate_limit_event", rate_limit_info: {} });
  writeEvent({ type: "system", subtype: "thinking_tokens", estimated_tokens: 1 });
  const requestedReviewers = [
    "correctness-reviewer",
    "scope-reviewer"
  ].filter((name) => process.env.FAKE_CLAUDE_SKIP_AGENT_CALL !== name);
  if (process.env.FAKE_CLAUDE_UNKNOWN_AGENT) {
    requestedReviewers.push(process.env.FAKE_CLAUDE_UNKNOWN_AGENT);
  }
  const tasks = requestedReviewers.map((subagentType, index) => ({
    subagentType,
    taskId: `task-${index + 1}`,
    toolUseId: `tool-${index + 1}`
  }));
  for (const { subagentType, taskId, toolUseId } of tasks) {
    writeEvent({
      type: "system",
      subtype: "task_started",
      task_id: taskId,
      tool_use_id: toolUseId,
      subagent_type: subagentType
    });
    if (process.env.FAKE_CLAUDE_DUPLICATE_AGENT_CALL === subagentType) {
      writeEvent({
        type: "system",
        subtype: "task_started",
        task_id: `${taskId}-duplicate`,
        tool_use_id: `${toolUseId}-duplicate`,
        subagent_type: subagentType
      });
    }
    writeEvent({
      type: "system",
      subtype: "task_updated",
      task_id: taskId,
      patch: {}
    });
  }
  if (process.env.FAKE_CLAUDE_FINAL_BEFORE_COMPLETIONS === "1") {
    writeResultEvent();
  }
  for (const { subagentType, taskId, toolUseId } of tasks) {
    if (process.env.FAKE_CLAUDE_SKIP_AGENT_RESULT === subagentType) {
      continue;
    }
    const failed = process.env.FAKE_CLAUDE_ERROR_AGENT_RESULT === subagentType;
    writeEvent({
      type: "system",
      subtype: "task_notification",
      task_id: taskId,
      tool_use_id:
        process.env.FAKE_CLAUDE_MISMATCH_AGENT_RESULT === subagentType
          ? `${toolUseId}-mismatch`
          : toolUseId,
      status: failed ? "failed" : "completed",
      is_error: failed,
      ...(failed ? { error: { kind: "synthetic" } } : {})
    });
  }
  if (process.env.FAKE_CLAUDE_FINAL_BEFORE_COMPLETIONS !== "1") {
    writeResultEvent();
  }
} else {
  process.stdout.write(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      structured_output: structuredOutput
    })
  );
}
