import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const managementPageSourceUrl = new URL("./management-page.tsx", import.meta.url);
const stylesSourceUrl = new URL("../../app/globals.css", import.meta.url);
const managementScreenSourceUrls = [
  new URL(
    "../../features/tenant-chat-admin/components/chat-app-routing-setup.tsx",
    import.meta.url
  ),
  new URL("../../features/projects/components/project-management.tsx", import.meta.url),
  new URL(
    "../../features/employees/components/employee-control-management.tsx",
    import.meta.url
  ),
  new URL(
    "../../features/provider-connections/components/provider-connection-management.tsx",
    import.meta.url
  ),
  new URL("../../features/api-keys/components/api-key-management.tsx", import.meta.url),
  new URL("../../features/policies/components/runtime-policy-editor.tsx", import.meta.url)
];

test("primary management screens share one responsive full-width page component", async () => {
  const [componentSource, styles, ...screenSources] = await Promise.all([
    readFile(managementPageSourceUrl, "utf8"),
    readFile(stylesSourceUrl, "utf8"),
    ...managementScreenSourceUrls.map((sourceUrl) => readFile(sourceUrl, "utf8"))
  ]);

  expect(componentSource).toContain(
    '"console-content management-line-content management-page"'
  );
  for (const screenSource of screenSources) {
    expect(screenSource).toContain('import { ManagementPage } from "@/components/layout/management-page"');
    expect(screenSource).toContain("<ManagementPage");
    expect(screenSource).toContain("</ManagementPage>");
  }

  expect(styles).toMatch(
    /\.management-page\.console-content \{[\s\S]*?width: 100%;[\s\S]*?max-width: none;[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/
  );
  expect(styles).toMatch(
    /@media \(max-width: 760px\) \{[\s\S]*?\.management-page\.console-content \{[\s\S]*?padding: 20px 16px 36px;/
  );
});

test("API management uses the enlarged primary action scale", async () => {
  const styles = await readFile(stylesSourceUrl, "utf8");

  expect(styles).toMatch(
    /\.api-key-list-toolbar \[data-slot="button"\]\.api-key-issue-trigger \{[\s\S]*?min-width: 132px;[\s\S]*?min-height: 44px;[\s\S]*?padding-inline: 20px;[\s\S]*?font-size: 16px;/
  );
  expect(styles).toMatch(
    /\.api-key-list-toolbar \[data-slot="button"\]\.api-key-issue-trigger svg \{\s*width: 18px;\s*height: 18px;/
  );
});
