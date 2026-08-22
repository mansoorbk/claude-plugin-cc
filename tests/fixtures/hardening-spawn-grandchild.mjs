import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pidPath = process.env.HARDENING_GRANDCHILD_PID_FILE;
if (!pidPath) {
  throw new Error("HARDENING_GRANDCHILD_PID_FILE is required");
}
const claudePidPath = process.env.HARDENING_CLAUDE_PID_FILE;
if (!claudePidPath) {
  throw new Error("HARDENING_CLAUDE_PID_FILE is required");
}
writeFileSync(claudePidPath, String(process.pid), "utf8");

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
const grandchild = spawn(
  process.execPath,
  [join(fixtureDirectory, "hardening-grandchild.mjs")],
  {
    detached: false,
    stdio: "ignore",
    windowsHide: true
  }
);
grandchild.unref();
writeFileSync(pidPath, String(grandchild.pid), "utf8");

const confirmedPath = process.env.HARDENING_GRANDCHILD_CONFIRMED_FILE;
if (!confirmedPath) {
  throw new Error("HARDENING_GRANDCHILD_CONFIRMED_FILE is required");
}
const deadline = Date.now() + 1_000;
while (!existsSync(process.env.HARDENING_GRANDCHILD_READY_FILE)) {
  if (Date.now() >= deadline) {
    throw new Error("grandchild did not become ready");
  }
  await new Promise((resolve) => setTimeout(resolve, 10));
}
await new Promise((resolve) => setTimeout(resolve, 100));
process.kill(grandchild.pid, 0);
writeFileSync(confirmedPath, String(grandchild.pid), "utf8");

setInterval(() => {}, 1_000);
