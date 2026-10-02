import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

try {
  const relativePath = import.meta.url.endsWith(".ts") ? "../../../../.env" : "../../../.env";
  loadEnvFile(fileURLToPath(new URL(relativePath, import.meta.url)));
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
}
