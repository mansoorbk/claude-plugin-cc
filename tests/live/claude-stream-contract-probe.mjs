import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildClaudeArguments,
  monitorClaudeProcess,
  startUnixProcessTreeObserver,
  startWindowsProcessTreeObserver,
  terminateProcessTree,
  taskNotificationIsSuccessful
} from "../../plugins/claude-adversarial-review/scripts/claude-companion.mjs";

const reviewers = ["correctness-reviewer", "scope-reviewer"];
const expectedInitTools = ["StructuredOutput", "Task"];
const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim() !== "";
const agents = {
  "lead-reviewer": {
    description: "Runs the synthetic delegation contract probe.",
    prompt: "Call each configured reviewer exactly once, wait for both, then return the required JSON.",
    tools: ["Agent(correctness-reviewer,scope-reviewer)", "StructuredOutput"],
    permissionMode: "plan"
  },
  "correctness-reviewer": {
    description: "Returns a synthetic completion.",
    prompt: "Return the word completed. Do not use tools.",
    tools: [],
    permissionMode: "plan"
  },
  "scope-reviewer": {
    description: "Returns a synthetic completion.",
    prompt: "Return the word completed. Do not use tools.",
    tools: [],
    permissionMode: "plan"
  }
};

export function buildLiveProbeInvocation() {
  return {
    schema,
    agents,
    argv: buildClaudeArguments(schema, agents)
  };
}
const schema = {
  type: "object",
  additionalProperties: false,
  properties: { ok: { const: true } },
  required: ["ok"]
};
export function observeClaudeStream(stdout, stderr = "") {
const eventMetadata = [];
const systemToolNames = new Set();
const initConfiguredReviewerNames = new Set();
const taskEvents = [];
const contractTaskEvents = [];
const contractResultEvents = [];
const contractInitEvents = [];
const taskReviewers = new Map();
let finalResult = null;
for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
  const event = JSON.parse(line);
  const eventIndex = eventMetadata.length;
  eventMetadata.push({
    type: event.type ?? null,
    subtype: event.subtype ?? null,
    keys: Object.keys(event).sort()
  });
  if (event.type === "system" && event.subtype === "init") {
    const initToolNames = Array.isArray(event.tools)
      ? event.tools
        .map((tool) => typeof tool === "string" ? tool : tool?.name)
        .filter((name) => typeof name === "string")
      : [];
    for (const name of initToolNames) {
      systemToolNames.add(name);
    }
    const configuredAgentNames = Array.isArray(event.agents)
      ? event.agents
        .map((agent) => typeof agent === "string" ? agent : agent?.name)
        .filter((name) => typeof name === "string")
      : event.agents && typeof event.agents === "object"
        ? Object.keys(event.agents)
        : [];
    for (const reviewer of reviewers) {
      if (configuredAgentNames.includes(reviewer)) {
        initConfiguredReviewerNames.add(reviewer);
      }
    }
    contractInitEvents.push({
      tools: initToolNames,
      configuredAgentNames
    });
  }
  if (
    event.type === "system" &&
    (event.subtype === "task_started" || event.subtype === "task_notification")
  ) {
    const allowlistedKeys = new Set([
      "type",
      "subtype",
      "task_id",
      "tool_use_id",
      "status",
      "is_error",
      "error",
      "subagent_type",
      "agent"
    ]);
    const directReviewer = reviewers.includes(event.subagent_type)
      ? event.subagent_type
      : null;
    if (directReviewer && typeof event.task_id === "string") {
      taskReviewers.set(event.task_id, directReviewer);
    }
    const reviewer = directReviewer || taskReviewers.get(event.task_id) || null;
    const failed = new Set(["failed", "error", "cancelled"]);
    taskEvents.push({
      type: event.subtype,
      subtype: event.subtype ?? null,
      keys: Object.keys(event).filter((key) => allowlistedKeys.has(key)).sort(),
      configuredReviewerNames: reviewer ? [reviewer] : [],
      task_id: typeof event.task_id === "string" ? event.task_id : null,
      tool_use_id:
        typeof event.tool_use_id === "string" ? event.tool_use_id : null,
      statusBooleans: {
        present: typeof event.status === "string",
        succeeded: event.status === "succeeded",
        completed: event.status === "completed",
        isError: event.is_error === true,
        hasErrorPayload: Object.hasOwn(event, "error"),
        failed: failed.has(event.status)
      }
    });
    contractTaskEvents.push({
      type: event.subtype,
      reviewer,
      taskId: event.task_id,
      toolUseId: event.tool_use_id,
      status: event.status,
      isError: event.is_error,
      hasErrorPayload: Object.hasOwn(event, "error"),
      eventIndex
    });
  }
  if (event.type === "result") {
    finalResult = event;
    contractResultEvents.push({
      subtype: event.subtype,
      isError: event.is_error,
      hasStructuredOutput: Object.prototype.hasOwnProperty.call(
        event,
        "structured_output"
      ),
      eventIndex
    });
  }
}
const collectNumericBooleanFields = (value, prefix = "", result = {}) => {
  if (!value || typeof value !== "object") {
    return result;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "number" || typeof child === "boolean") {
      result[childPath] = child;
    } else if (child && typeof child === "object") {
      collectNumericBooleanFields(child, childPath, result);
    }
  }
  return result;
};
const summary = {
  eventMetadata,
  systemToolNames: [...systemToolNames].sort(),
  initConfiguredReviewerNames: [...initConfiguredReviewerNames].sort(),
  resultSubagents: collectNumericBooleanFields(finalResult?.subagents),
  taskEvents,
  hasStructuredOutput: finalResult?.structured_output !== undefined,
  stderrCategories: {
    schemaRejection: /schema|structured[_ ]output/i.test(stderr),
    unknownTool: /unknown tool|invalid tool|tool[^\r\n]*(?:not allowed|not available|not found)/i.test(stderr),
    unknownAgent: /unknown agent|agent[^\r\n]*(?:not configured|not available|not found)/i.test(stderr)
  }
};
return {
  summary,
  contract: {
    eventCount: eventMetadata.length,
    initEvents: contractInitEvents,
    taskEvents: contractTaskEvents,
    resultEvents: contractResultEvents,
    stderrCategories: summary.stderrCategories
  }
};
}

export function probeContractIsSatisfied(observation) {
  if (
    Object.values(observation.contract.stderrCategories).some(Boolean) ||
    observation.contract.initEvents.length !== 1
  ) {
    return false;
  }
  const [init] = observation.contract.initEvents;
  if (
    init.tools.length !== expectedInitTools.length ||
    !expectedInitTools.every((tool) => init.tools.includes(tool)) ||
    !reviewers.every((reviewer) => init.configuredAgentNames.includes(reviewer))
  ) {
    return false;
  }
  const resultEvents = observation.contract.resultEvents;
  if (resultEvents.length !== 1) {
    return false;
  }
  const [result] = resultEvents;
  if (
    result.subtype !== "success" ||
    result.isError !== false ||
    result.hasStructuredOutput !== true ||
    result.eventIndex !== observation.contract.eventCount - 1
  ) {
    return false;
  }
  const reviewerIdentities = new Map();
  const identityReviewers = new Map();
  const completedReviewers = new Set();
  let startCount = 0;
  let notificationCount = 0;
  for (const event of observation.contract.taskEvents) {
    if (event.type === "task_started") {
      startCount += 1;
      const reviewer = event.reviewer;
      if (
        !reviewers.includes(reviewer) ||
        !isNonEmptyString(event.taskId) ||
        !isNonEmptyString(event.toolUseId) ||
        reviewerIdentities.has(reviewer)
      ) {
        return false;
      }
      const identity = JSON.stringify([event.taskId, event.toolUseId]);
      if (identityReviewers.has(identity)) {
        return false;
      }
      reviewerIdentities.set(reviewer, identity);
      identityReviewers.set(identity, reviewer);
      continue;
    }
    if (event.type !== "task_notification") {
      return false;
    }
    notificationCount += 1;
    const identity = JSON.stringify([event.taskId, event.toolUseId]);
    const reviewer = identityReviewers.get(identity);
    if (
      !reviewer ||
      !taskNotificationIsSuccessful(
        event.status,
        event.isError,
        event.hasErrorPayload
      ) ||
      event.eventIndex >= result.eventIndex ||
      completedReviewers.has(reviewer)
    ) {
      return false;
    }
    completedReviewers.add(reviewer);
  }
  if (startCount !== reviewers.length || notificationCount !== reviewers.length) {
    return false;
  }
  return reviewers.every((reviewer) =>
    completedReviewers.has(reviewer) && reviewerIdentities.has(reviewer)
  );
}

export async function runLiveProbe(dependencies = {}) {
  const spawnFn = dependencies.spawnFn ?? spawn;
  const monitorClaudeProcessFn =
    dependencies.monitorClaudeProcessFn ?? monitorClaudeProcess;
  const terminateProcessTreeFn =
    dependencies.terminateProcessTreeFn ?? terminateProcessTree;
  const platform = dependencies.platform ?? process.platform;
  const startProcessTreeObserverFn =
    dependencies.startProcessTreeObserverFn ??
    (platform === "win32"
      ? startWindowsProcessTreeObserver
      : startUnixProcessTreeObserver);
  const writeSummaryFn = dependencies.writeSummaryFn ?? ((summary) => {
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  });
  const invocation = buildLiveProbeInvocation();
  const observer = await startProcessTreeObserverFn();
  const stopObserverImpl = observer?.stop.bind(observer);
  let observerStopPromise = null;
  const stopObserverOnce = (...args) => {
    if (observerStopPromise === null) {
      observerStopPromise = stopObserverImpl?.(...args) ?? Promise.resolve();
    }
    return observerStopPromise;
  };
  if (observer) {
    observer.stop = stopObserverOnce;
  }
  let child;
  try {
    child = spawnFn("claude", invocation.argv, {
      shell: false,
      detached: platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    observer?.attach(child);
  } catch (error) {
    await stopObserverOnce();
    throw error;
  }
  let cleanupPromise = null;
  const cleanupOnce = (ownedChild = child) => {
    if (cleanupPromise === null) {
      cleanupPromise = terminateProcessTreeFn(ownedChild);
    }
    return cleanupPromise;
  };
  try {
    const { outcome, stdoutChunks, stderrChunks } =
      await monitorClaudeProcessFn(
        child,
        "Perform the synthetic delegation probe and return {\"ok\":true}.",
        {
          timeoutMs: 120_000,
          maxStdoutBytes: 4 * 1024 * 1024,
          maxStderrBytes: 1024 * 1024,
          terminateProcessTreeFn: cleanupOnce
        }
      );
    if (outcome.kind === "start-error" || outcome.status !== 0) {
      throw new Error(
        `Claude stream probe failed with status ${outcome.status ?? "start-error"}.`
      );
    }
    const observation = observeClaudeStream(
      Buffer.concat(stdoutChunks).toString("utf8"),
      Buffer.concat(stderrChunks).toString("utf8")
    );
    writeSummaryFn(observation.summary);
    if (!probeContractIsSatisfied(observation)) {
      throw new Error(
        "Claude stream contract did not expose both completed reviewers and a structured result."
      );
    }
  } catch (error) {
    let cleanupError = null;
    try {
      await cleanupOnce(child);
    } catch (candidate) {
      cleanupError = candidate;
    }
    try {
      await stopObserverOnce();
    } catch (candidate) {
      cleanupError ??= candidate;
    }
    if (cleanupError !== null) {
      throw cleanupError;
    }
    throw error;
  }
  await stopObserverOnce();
}

const IS_MAIN = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_MAIN) {
  await runLiveProbe();
}
