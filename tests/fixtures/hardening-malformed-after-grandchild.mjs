import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pidPath = process.env.HARDENING_GRANDCHILD_PID_FILE;
const readyPath = process.env.HARDENING_GRANDCHILD_READY_FILE;
if (!pidPath || !readyPath) {
  throw new Error("grandchild PID and ready paths are required");
}

for await (const _chunk of process.stdin) {
  // Consume the complete review prompt before returning malformed output.
}

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
const grandchild = spawn(
  process.execPath,
  [join(fixtureDirectory, "hardening-grandchild.mjs")],
  {
    detached: process.platform === "win32",
    stdio: "ignore",
    windowsHide: true
  }
);
grandchild.unref();
writeFileSync(pidPath, String(grandchild.pid), "utf8");

const deadline = Date.now() + 2_000;
while (!existsSync(readyPath)) {
  if (Date.now() >= deadline) {
    throw new Error("descendant did not become ready");
  }
  await new Promise((resolve) => setTimeout(resolve, 10));
}

process.stdout.write("malformed Claude event\n");
