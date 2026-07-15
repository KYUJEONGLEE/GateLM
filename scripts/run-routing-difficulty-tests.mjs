import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toolRoot = path.join(root, "scripts", "routing_difficulty_model");
const configuredPython = process.env.GATELM_DIFFICULTY_PYTHON?.trim();
const localPython =
  process.platform === "win32"
    ? path.join(root, ".tmp", "difficulty-semantic-encoder-venv", "Scripts", "python.exe")
    : path.join(root, ".tmp", "difficulty-semantic-encoder-venv", "bin", "python");
const candidates = [
  ...(configuredPython ? [configuredPython] : []),
  ...(existsSync(localPython) ? [localPython] : []),
  ...(process.platform === "win32" ? ["python"] : ["python3", "python"]),
];
const args = [
  "-m",
  "unittest",
  "discover",
  "-s",
  "scripts/routing_difficulty_model/tests",
  "-p",
  "test_*.py",
  "-v",
];
const env = {
  ...process.env,
  PYTHONPATH: [toolRoot, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
};

for (const command of candidates) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit" });
  if (result.error?.code === "ENOENT") {
    continue;
  }
  if (result.error) {
    throw result.error;
  }
  process.exit(result.status ?? 1);
}

throw new Error(
  "Python was not found; set GATELM_DIFFICULTY_PYTHON or install python3/python",
);
