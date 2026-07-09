import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  removeApplicationChatEnvProjectFromFile,
  syncApplicationChatEnvForProjectsFile
} from "./application-chat-env-file-core";

test("removes only the archived project from the Application Chat API key map", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "gatelm-env-sync-"));
  const envFilePath = path.join(tempDir, ".env");

  try {
    await writeFile(
      envFilePath,
      [
        "GATELM_APPLICATION_CHAT_AUTO_PROFILES=true",
        `GATELM_APPLICATION_CHAT_API_KEYS='{"00000000-0000-4000-8000-000000000201":"placeholder_archived","00000000-0000-4000-8000-000000000202":"placeholder_active"}'`,
        "OTHER_ENV=value"
      ].join("\n"),
      "utf8"
    );

    await removeApplicationChatEnvProjectFromFile({
      envFilePath,
      projectId: "00000000-0000-4000-8000-000000000201"
    });

    const content = await readFile(envFilePath, "utf8");

    expect(content).not.toContain("00000000-0000-4000-8000-000000000201");
    expect(content).toContain(
      `GATELM_APPLICATION_CHAT_API_KEYS='{"00000000-0000-4000-8000-000000000202":"placeholder_active"}'`
    );
    expect(content).toContain("OTHER_ENV=value");
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("resolves fallback env file path relative to the provided cwd", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "gatelm-env-cwd-"));
  const nestedCwd = path.join(tempDir, "apps", "web");
  const envFilePath = path.join(tempDir, ".env");

  try {
    await mkdir(nestedCwd, { recursive: true });

    await syncApplicationChatEnvForProjectsFile(
      [
        {
          createdAt: "2026-07-09T00:00:00.000Z",
          description: null,
          id: "00000000-0000-4000-8000-000000000301",
          name: "Fallback Project",
          runtimeApplicationId: "00000000-0000-4000-8000-000000000401",
          status: "ACTIVE",
          tenantId: "00000000-0000-4000-8000-000000000100",
          totalBudgetUsd: 100,
          updatedAt: "2026-07-09T00:01:00.000Z",
          warningThresholdPercent: 80
        }
      ],
      {
        cwd: nestedCwd,
        env: {}
      }
    );

    const content = await readFile(envFilePath, "utf8");

    expect(content).toContain("GATELM_APPLICATION_CHAT_AUTO_PROFILES=true");
    expect(content).toContain("00000000-0000-4000-8000-000000000301");
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});
