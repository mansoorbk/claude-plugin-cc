import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const projectRoot = resolve(testsDirectory, "..");
export const companionPath = join(
  projectRoot,
  "plugins",
  "claude-adversarial-review",
  "scripts",
  "claude-companion.mjs"
);
export const fakeClaudePath = join(testsDirectory, "fixtures", "fake-claude.mjs");

export function makeTempDirectory(t, prefix = "claude-adversarial-review-") {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

export function writeText(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
}

export function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr || result.stdout;
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout.trimEnd();
}

export function createRepository(t) {
  const cwd = makeTempDirectory(t, "claude-review-repo-");
  git(cwd, "init", "--initial-branch=main");
  git(cwd, "config", "user.email", "tests@example.invalid");
  git(cwd, "config", "user.name", "Companion Tests");
  writeText(join(cwd, "staged.txt"), "initial staged\n");
  writeText(join(cwd, "unstaged.txt"), "initial unstaged\n");
  writeText(join(cwd, "src", "example.js"), "export const example = true;\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "initial");
  return cwd;
}

export function addWorkingCandidate(
  cwd,
  contents = "export const candidate = true;\n"
) {
  writeText(join(cwd, "candidate.js"), contents);
}

export function runCompanion(cwd, args = [], options = {}) {
  const ownsLogDirectory = !options.logPath;
  const logDirectory = ownsLogDirectory
    ? mkdtempSync(join(tmpdir(), "fake-claude-log-"))
    : dirname(options.logPath);
  const logPath = options.logPath || join(logDirectory, "invocation.json");
  const env = {
    ...process.env,
    NO_COLOR: "1",
    CLAUDE_ADVERSARIAL_REVIEW_TEST_MODE: "1",
    CLAUDE_ADVERSARIAL_REVIEW_CLAUDE_COMMAND: JSON.stringify([
      process.execPath,
      fakeClaudePath
    ]),
    FAKE_CLAUDE_LOG: logPath,
    ...options.env
  };
  options.onLogDirectory?.(logDirectory);
  try {
    const result = spawnSync(
      process.execPath,
      [companionPath, "adversarial-review", "--json", ...args],
      {
        cwd,
        encoding: "utf8",
        env,
        timeout: options.timeoutMs ?? 20_000
      }
    );
    const invocation = existsSync(logPath)
      ? JSON.parse(readFileSync(logPath, "utf8"))
      : null;
    return { ...result, logPath, invocation };
  } finally {
    if (ownsLogDirectory) {
      rmSync(logDirectory, { recursive: true, force: true });
    }
  }
}

export function readInvocation(logPath) {
  return JSON.parse(readFileSync(logPath, "utf8"));
}

export function snapshotRepository(cwd) {
  return {
    head: git(cwd, "rev-parse", "HEAD"),
    status: git(cwd, "status", "--porcelain=v1", "--untracked-files=all"),
    stagedDiff: git(cwd, "diff", "--cached", "--binary"),
    unstagedDiff: git(cwd, "diff", "--binary")
  };
}
