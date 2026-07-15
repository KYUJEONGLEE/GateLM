import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const goCache = path.join(rootDir, ".cache", "go-build");

const commands = [
  {
    name: "selected 118D generated bundle drift",
    args: [
      "run",
      "./apps/gateway-core/cmd/difficulty-model-codegen",
      "-profile",
      "gateway-shadow-118d",
      "-artifact",
      "scripts/routing_difficulty_model/artifacts/candidates/difficulty-candidate-c-118d.owner-approved-500.v2.json",
      "-output",
      "apps/gateway-core/internal/domain/routing/difficulty_model_118d_generated.go",
      "-check",
    ],
  },
  {
    name: "selected 118D codegen and inference tests",
    args: [
      "test",
      "./apps/gateway-core/internal/tools/difficultymodel",
      "./apps/gateway-core/cmd/difficulty-model-codegen",
      "./apps/gateway-core/internal/domain/routing",
    ],
  },
];

for (const command of commands) {
  console.log(`\n==> ${command.name}`);
  const result = spawnSync("go", command.args, {
    cwd: rootDir,
    env: { ...process.env, GOCACHE: goCache },
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`${command.name}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("\nGateway shadow 118D bundle verification passed.");

