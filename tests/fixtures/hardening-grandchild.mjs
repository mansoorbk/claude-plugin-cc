import { writeFileSync } from "node:fs";

const readyPath = process.env.HARDENING_GRANDCHILD_READY_FILE;
if (!readyPath) {
  throw new Error("HARDENING_GRANDCHILD_READY_FILE is required");
}
writeFileSync(readyPath, String(process.pid), "utf8");
setInterval(() => {}, 1_000);
