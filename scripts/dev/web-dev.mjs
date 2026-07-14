import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_NODE_MAJOR = 22;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const nextCli = path.join(
  repositoryRoot,
  "apps/web/node_modules/next/dist/bin/next"
);
const useWebpack = process.argv.includes("--webpack");
const nodeBinary = resolveNodeBinary();

if (!nodeBinary) {
  console.error(
    `GateLM Web requires Node ${REQUIRED_NODE_MAJOR}. ` +
      `Current runtime is ${process.versions.node}. Install Node 22 or set GATELM_NODE_BINARY.`
  );
  process.exit(1);
}

const child = spawn(
  nodeBinary,
  [
    nextCli,
    "dev",
    ...(useWebpack ? [] : ["--turbopack"]),
    "--hostname",
    "0.0.0.0",
    "--port",
    "3000"
  ],
  {
    cwd: path.join(repositoryRoot, "apps/web"),
    env: process.env,
    stdio: "inherit"
  }
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

child.once("error", (error) => {
  console.error("Failed to start the GateLM Web development server.", error);
  process.exit(1);
});

child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

function resolveNodeBinary() {
  const candidates = [
    process.env.GATELM_NODE_BINARY,
    process.execPath,
    "/opt/homebrew/opt/node@22/bin/node",
    "/usr/local/opt/node@22/bin/node"
  ];

  return candidates.find((candidate) => {
    if (!candidate || !existsSync(candidate)) {
      return false;
    }

    const result = spawnSync(candidate, ["-p", "process.versions.node"], {
      encoding: "utf8"
    });
    if (result.error || result.status !== 0) {
      return false;
    }

    const version = result.stdout?.trim() ?? "";

    return Number.parseInt(version.split(".")[0] ?? "", 10) === REQUIRED_NODE_MAJOR;
  });
}
