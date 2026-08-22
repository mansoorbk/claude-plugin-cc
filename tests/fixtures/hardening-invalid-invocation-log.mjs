import { writeFileSync } from "node:fs";

writeFileSync(process.env.FAKE_CLAUDE_LOG, "{", "utf8");
process.exit(1);
