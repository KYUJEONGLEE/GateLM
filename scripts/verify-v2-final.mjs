import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const skipDirs = new Set([
  ".cache",
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "reports",
]);

const textFileExtensions = new Set([
  ".cjs",
  ".go",
  ".js",
  ".json",
  ".jsonl",
  ".md",
  ".mjs",
  ".ps1",
  ".py",
  ".sh",
  ".ts",
  ".tsx",
  ".yml",
  ".yaml",
]);

const forbiddenSecretPatterns = [
  {
    name: "OpenAI/provider key shape",
    pattern: /\bsk-[A-Za-z0-9_-]{12,}\b/,
  },
  {
    name: "Bearer token literal",
    pattern: /\bBearer\s+[A-Za-z0-9._-]{12,}\b/,
  },
  {
    name: "private key block",
    pattern: /-----BEGIN\s+(RSA|OPENSSH|EC|PRIVATE)\s+KEY-----/,
  },
];

const intentionalSecretShapePathPatterns = [
  /^apps\/ai-service\/app\/tests\//,
  /^apps\/gateway-core\/.*_test\.go$/,
  /^docs\/archive\//,
  /^docs\/architecture\/api-spec\.md$/,
];

const commands = [
  {
    name: "whitespace",
    command: "git",
    args: ["diff", "--check"],
  },
  {
    name: "v2 docs",
    command: "pnpm",
    args: ["run", "verify:v2-docs"],
  },
  {
    name: "control-plane typecheck",
    command: "pnpm",
    args: ["--filter", "@gatelm/control-plane-api", "typecheck"],
  },
  {
    name: "control-plane tests",
    command: "pnpm",
    args: ["--filter", "@gatelm/control-plane-api", "test", "--", "--runInBand"],
  },
  {
    name: "web typecheck",
    command: "pnpm",
    args: ["--filter", "@gatelm/web", "typecheck"],
  },
  {
    name: "gateway go tests",
    command: "go",
    args: ["test", "./..."],
    cwd: path.join(rootDir, "apps/gateway-core"),
    env: {
      GOCACHE: path.join(rootDir, ".cache", "go-build"),
    },
  },
];

function runCommand(step) {
  console.log(`\n==> ${step.name}`);
  const result = spawnSync(step.command, step.args, {
    cwd: step.cwd ?? rootDir,
    env: {
      ...process.env,
      ...(step.env ?? {}),
    },
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  if (result.error) {
    failures.push(`${step.name}: ${result.error.message}`);
    return;
  }

  if (result.status !== 0) {
    failures.push(`${step.name}: exited with ${result.status}`);
  }
}

function scanSecrets() {
  console.log("\n==> forbidden secret-shaped value scan");
  for (const filePath of listTextFiles(rootDir)) {
    const relativePath = path.relative(rootDir, filePath).replaceAll(path.sep, "/");
    if (intentionalSecretShapePathPatterns.some((pattern) => pattern.test(relativePath))) {
      continue;
    }
    const text = readFileSync(filePath, "utf8");
    for (const { name, pattern } of forbiddenSecretPatterns) {
      if (pattern.test(text)) {
        failures.push(`${relativePath}: forbidden ${name}`);
      }
    }
  }
}

function listTextFiles(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const relativeParts = path.relative(rootDir, fullPath).split(path.sep);
    if (relativeParts.some((part) => skipDirs.has(part))) {
      continue;
    }

    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...listTextFiles(fullPath));
      continue;
    }

    if (stats.isFile() && textFileExtensions.has(path.extname(entry))) {
      files.push(fullPath);
    }
  }
  return files;
}

function assertToolingBaseline() {
  console.log("\n==> tooling baseline");
  const packageJson = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
  const nvmrc = readFileSync(path.join(rootDir, ".nvmrc"), "utf8").trim();
  const nodeVersion = readFileSync(path.join(rootDir, ".node-version"), "utf8").trim();

  if (nvmrc !== "22" || nodeVersion !== "22") {
    failures.push("Node baseline files must both be 22");
  }
  if (packageJson.packageManager !== "pnpm@9.15.0") {
    failures.push("packageManager must be pnpm@9.15.0");
  }
  if (packageJson.engines?.node !== ">=22 <23") {
    failures.push('engines.node must be ">=22 <23"');
  }

  console.log(`node baseline: ${nvmrc}`);
  console.log(`pnpm baseline: ${packageJson.packageManager}`);
}

function main() {
  assertToolingBaseline();
  scanSecrets();

  for (const command of commands) {
    if (command.command === "go" && !existsSync(command.cwd)) {
      failures.push(`${command.name}: missing cwd ${command.cwd}`);
      continue;
    }
    runCommand(command);
  }

  if (failures.length > 0) {
    console.error("\nv2 final hardening failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("\nv2 final hardening passed.");
}

main();
