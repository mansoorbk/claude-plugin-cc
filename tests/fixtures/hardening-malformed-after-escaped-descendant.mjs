import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pidPath = process.env.HARDENING_GRANDCHILD_PID_FILE;
const readyPath = process.env.HARDENING_GRANDCHILD_READY_FILE;
if (!pidPath || !readyPath) {
  process.exit(2);
}

const grandchildPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "hardening-grandchild.mjs"
);
const grandchild = spawn(process.execPath, [grandchildPath], {
  detached: true,
  env: {
    ...process.env,
    HARDENING_GRANDCHILD_READY_FILE: readyPath
  },
  stdio: "ignore",
  windowsHide: true
});
grandchild.unref();
writeFileSync(pidPath, String(grandchild.pid), "utf8");

const deadline = Date.now() + 5_000;
while (!existsSync(readyPath)) {
  if (Date.now() >= deadline) {
    process.exit(3);
  }
  await new Promise((resolve) => setTimeout(resolve, 10));
}

// Keep the original lineage visible across at least one production observer cadence.
await new Promise((resolve) => setTimeout(resolve, 1_500));
process.stdout.write("not-json\n");
