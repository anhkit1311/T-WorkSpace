import { fileURLToPath } from "node:url";

/** Written by global-setup, read by the specs; holds the run's generated test password (gitignored). */
export const fixturesFile = fileURLToPath(new URL("../test-results/e2e-fixtures.json", import.meta.url));
