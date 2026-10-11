import { spawnSync } from "node:child_process";
const result = spawnSync(
  process.execPath,
  [
    "--test",
    "services/api/test/integration.test.js",
    "services/api/test/governance.test.js",
    "services/api/test/conversations.test.js",
    "services/api/test/tasks.test.js",
    "services/api/test/meeting-sessions.test.js",
    "services/api/test/meeting-outcomes.test.js",
    "services/api/test/distributed.test.js",
    "services/api/test/storage.test.js",
    "services/api/test/worker-recovery.test.js",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      RUN_DB_TESTS: "1",
      RUN_SFU_TESTS: process.argv.includes("--sfu") ? "1" : "0",
    },
  },
);
process.exitCode = result.status ?? 1;
