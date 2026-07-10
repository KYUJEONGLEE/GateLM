import { expect, test } from "@playwright/test";
import { projectPillTone } from "./components/live-requests-view";

test("returns a stable project pill tone when project identifiers are missing", () => {
  const missingTone = projectPillTone(undefined);

  expect(missingTone).toBeGreaterThanOrEqual(0);
  expect(missingTone).toBeLessThan(6);
  expect(projectPillTone(null)).toBe(missingTone);
  expect(projectPillTone("")).toBe(missingTone);
});
