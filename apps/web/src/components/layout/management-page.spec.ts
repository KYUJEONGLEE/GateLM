import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import { orderOnboardingProviderRows } from "../../features/onboarding/components/onboarding-provider-order";

const managementPageSourceUrl = new URL("./management-page.tsx", import.meta.url);
const stylesSourceUrl = new URL("../../app/globals.css", import.meta.url);
const buttonSourceUrl = new URL("../ui/button.tsx", import.meta.url);
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

test("API management uses the shared primary action scale", async () => {
  const styles = await readFile(stylesSourceUrl, "utf8");

  expect(styles).toMatch(
    /\.api-key-list-toolbar \[data-slot="button"\]\.api-key-issue-trigger \{[\s\S]*?min-width: 0;[\s\S]*?min-height: var\(--primary-action-height\);[\s\S]*?padding-inline: var\(--primary-action-padding-inline\);/
  );
  expect(styles).toMatch(
    /\.api-key-list-toolbar \[data-slot="button"\]\.api-key-issue-trigger svg \{\s*width: 16px;\s*height: 16px;/
  );
});

test("Provider cards keep a compact readable layout on mobile", async () => {
  const styles = await readFile(stylesSourceUrl, "utf8");

  expect(styles).toMatch(
    /@media \(max-width: 1100px\) \{[\s\S]*?\.provider-card-row \{[\s\S]*?grid-template-rows: auto auto;[\s\S]*?\.provider-card-identity \{[\s\S]*?grid-column: 1;[\s\S]*?grid-row: 1;/
  );
  expect(styles).toMatch(
    /@media \(max-width: 760px\) \{[\s\S]*?\.provider-card-row \{[\s\S]*?grid-template-areas:[\s\S]*?"identity identity"[\s\S]*?"status status"[\s\S]*?"meta actions";/
  );
  expect(styles).toMatch(
    /\.provider-card-status \{[\s\S]*?grid-area: status;[\s\S]*?grid-template-columns: 8px auto;[\s\S]*?width: max-content;/
  );
  expect(styles).toMatch(
    /\.provider-discovery-actions \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/
  );
});

test("primary actions share one visual token contract", async () => {
  const [styles, buttonSource] = await Promise.all([
    readFile(stylesSourceUrl, "utf8"),
    readFile(buttonSourceUrl, "utf8")
  ]);

  expect(styles).toContain("--primary-action-height: 46px;");
  expect(styles).toContain("--primary-action-padding-inline: 24px;");
  expect(styles).toContain("--primary-action-radius: 999px;");
  expect(styles).toContain("--primary-action-icon-size: 30px;");
  expect(styles).toContain("--primary-action-background: #2563eb;");
  expect(styles).toContain("--primary-action-background-hover: #1d4ed8;");
  expect(styles).toContain("--primary-action-shadow: 0 4px 10px rgba(37, 99, 235, 0.28);");
  expect(styles).toMatch(
    /\.primary-button,\s*\.secondary-button \{[\s\S]*?height: var\(--primary-action-height\);[\s\S]*?padding: 0 var\(--primary-action-padding-inline\);[\s\S]*?font-size: var\(--primary-action-font-size\);/
  );
  expect(buttonSource).toContain("h-[var(--primary-action-height)]");
  expect(buttonSource).toContain("px-[var(--primary-action-padding-inline)]");
  expect(buttonSource).toContain("text-[length:var(--primary-action-font-size)]");
  expect(buttonSource).toContain("bg-[var(--primary-action-background)]");
  expect(buttonSource).toContain("hover:bg-[var(--primary-action-background-hover)]");
  expect(styles).toContain('[data-slot="button"][data-variant="default"][data-size="default"]');
  expect(styles).toContain('[data-slot="button"][data-variant="default"][data-size="sm"]');
  expect(buttonSource).toContain('data-variant={variant}');
  expect(buttonSource).toContain('data-size={size}');
});

test("sorting and selection utilities share the compact action contract", async () => {
  const [styles, projectSource, employeeSource] = await Promise.all([
    readFile(stylesSourceUrl, "utf8"),
    readFile(
      new URL("../../features/projects/components/project-management.tsx", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL(
        "../../features/employees/components/employee-control-management.tsx",
        import.meta.url
      ),
      "utf8"
    )
  ]);

  expect(styles).toContain("--compact-action-height: 34px;");
  expect(styles).toContain("--compact-action-radius: 8px;");
  expect(styles).toContain("--compact-action-font-size: 14px;");
  expect(styles).toMatch(
    /\.compact-action-button \{[\s\S]*?height: var\(--compact-action-height\);[\s\S]*?border-radius: var\(--compact-action-radius\);[\s\S]*?font-size: var\(--compact-action-font-size\);/
  );
  expect(projectSource).toContain('className="compact-action-button project-sort-button"');
  expect(employeeSource.match(/className="compact-action-button"/g)).toHaveLength(3);
});

test("project onboarding orders Provider choices by registration state before scrolling", async () => {
  const [styles, onboardingSource] = await Promise.all([
    readFile(stylesSourceUrl, "utf8"),
    readFile(
      new URL(
        "../../features/onboarding/components/onboarding-provider-registration.tsx",
        import.meta.url
      ),
      "utf8"
    )
  ]);
  const orderedRows = orderOnboardingProviderRows(
    [
      { family: "openai", id: "preset-openai" },
      { family: "gemini", id: "preset-gemini" },
      { family: "claude", id: "preset-claude" }
    ],
    [
      { family: "openai", id: "registered-openai" },
      { family: "anthropic", id: "registered-anthropic" },
      { family: "custom", id: "registered-custom" }
    ]
  );

  expect(orderedRows.map((row) => row.id)).toEqual([
    "preset-gemini",
    "registered-openai",
    "registered-anthropic",
    "registered-custom",
    "preset-openai",
    "preset-claude"
  ]);
  expect(styles).toMatch(
    /\.onboarding-provider-list \{[\s\S]*?max-height: 488px;[\s\S]*?overflow-y: auto;[\s\S]*?scrollbar-gutter: stable;/
  );
  expect(onboardingSource).toContain(
    "const [selectedProviderKeyState, setSelectedProviderKey] = useState<string | null>(null);"
  );
  expect(onboardingSource).toContain("providerRows[0]?.providerKey ?? \"\"");
});
