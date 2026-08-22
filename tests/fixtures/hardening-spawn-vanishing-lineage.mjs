import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
const intermediate = spawn(
  process.execPath,
  [join(fixtureDirectory, "hardening-vanishing-intermediate.mjs")],
  { stdio: "ignore", windowsHide: true }
);

await new Promise((resolve, reject) => {
  intermediate.once("error", reject);
  intermediate.once("close", (status) => {
    if (status === 0) {
      resolve();
    } else {
      reject(new Error(`intermediate exited with status ${status}`));
    }
  });
});
