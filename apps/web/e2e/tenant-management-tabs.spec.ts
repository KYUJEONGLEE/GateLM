import { expect, test, type Locator } from "@playwright/test";

const tenantManagementPath = "/tenants/tenant_demo_acme/tenants";
const testBaseUrl =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3000"}`;

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: "gatelm_session",
      url: testBaseUrl,
      value: "tenant-management-tabs-test"
    }
  ]);
});

test("tenant management renders the requested routing configuration", async ({ page }) => {
  await page.goto(tenantManagementPath);

  await expect(page.getByRole("heading", { exact: true, name: "Tenant 관리" })).toBeVisible();

  const tabList = page.getByRole("tablist", { exact: true, name: "Tenant 관리 섹션" });
  await expect(tabList).toHaveClass(/policy-section-tabs/);
  await expect(tabList.getByRole("tab")).toHaveText(["예산", "라우팅"]);

  const budgetTab = tabList.getByRole("tab", { exact: true, name: "예산" });
  const routingTab = tabList.getByRole("tab", { exact: true, name: "라우팅" });
  await expect(budgetTab).toHaveAttribute("aria-selected", "false");
  await expect(routingTab).toHaveAttribute("aria-selected", "true");

  const routingPanel = page.getByRole("tabpanel", { exact: true, name: "라우팅" });
  await expect(routingPanel.getByRole("heading", { exact: true, name: "Auto routing" })).toBeVisible();
  await expect(
    routingPanel.getByRole("heading", { exact: true, name: "카테고리별 모델 설정" })
  ).toBeVisible();
  await expect(
    routingPanel.getByRole("heading", { exact: true, name: "Fallback 모델 설정" })
  ).toBeVisible();
  await expect(
    routingPanel.getByRole("heading", { exact: true, name: "Auto routing OFF 시 기본 모델" })
  ).toHaveCount(0);
  await expect(routingPanel.locator(".tenant-routing-section-divider")).toBeVisible();
  await expect(routingPanel.getByRole("columnheader")).toHaveText([
    "카테고리",
    "기본 모델",
    "고성능 모델"
  ]);
  await expect(routingPanel.getByRole("rowheader")).toHaveText([
    "일반 채팅",
    "코드 생성",
    "번역",
    "요약 / 문서",
    "추론"
  ]);

  for (const removedCopy of [
    "검색 / RAG",
    "자동 분류",
    "분류되지 않은 요청: 일반 채팅으로 처리",
    "분류 기준"
  ]) {
    await expect(routingPanel.getByText(removedCopy, { exact: true })).toHaveCount(0);
  }

  const routingSwitch = routingPanel.getByRole("switch", { exact: true, name: "Auto routing" });
  await expect(routingSwitch).toHaveAttribute("aria-checked", "true");
  await expect(routingSwitch).toHaveCSS("background-color", "rgb(16, 163, 127)");
  await expectSwitchThumbInsideTrack(routingSwitch);
  await expect(
    routingPanel.getByRole("button", { exact: true, name: "변경사항 저장" })
  ).toHaveCSS("background-color", "rgb(16, 163, 127)");
});

test("routing controls can be changed, disabled, and reset locally", async ({ page }) => {
  await page.goto(tenantManagementPath);
  await page.getByRole("tab", { exact: true, name: "라우팅" }).click();

  const providerSelect = page.getByLabel("일반 채팅 기본 모델 제공자", { exact: true });
  const modelSelect = page.getByLabel("일반 채팅 기본 모델 모델", { exact: true });
  const fallbackProviderSelect = page.getByLabel("Fallback Provider", { exact: true });
  const fallbackModelSelect = page.getByLabel("Fallback 모델 선택", { exact: true });
  const offDefaultProviderSelect = page.getByLabel("Auto routing OFF 기본 Provider", {
    exact: true
  });
  const offDefaultModelSelect = page.getByLabel("Auto routing OFF 기본 모델 선택", {
    exact: true
  });
  const offDefaultHeading = page.getByRole("heading", {
    exact: true,
    name: "Auto routing OFF 시 기본 모델"
  });
  const routingSwitch = page.getByRole("switch", { exact: true, name: "Auto routing" });

  await expect(providerSelect).toHaveValue("openai");
  await expect(modelSelect).toHaveValue("GPT-4o");
  await expect(fallbackProviderSelect).toHaveValue("openai");
  await expect(fallbackModelSelect).toHaveValue("GPT-4o mini");
  await expect(offDefaultHeading).toHaveCount(0);

  const autoRoutingCard = page.locator(".tenant-routing-enable-card");
  const categoryModelCard = page.locator(".tenant-routing-model-card");
  const fallbackCard = page.locator(".tenant-routing-fallback-card");
  const onAutoRoutingWidth = await getRenderedWidth(autoRoutingCard);
  const onCategoryModelWidth = await getRenderedWidth(categoryModelCard);
  const onFallbackWidth = await getRenderedWidth(fallbackCard);

  const providerControlWidth = await providerSelect.evaluate(
    (element) => element.parentElement?.getBoundingClientRect().width ?? 0
  );
  const modelControlWidth = await modelSelect.evaluate(
    (element) => element.parentElement?.getBoundingClientRect().width ?? 0
  );

  expect(providerControlWidth).toBeLessThan(modelControlWidth);

  await providerSelect.selectOption("anthropic");
  await expect(modelSelect).toHaveValue("Claude Opus");
  await modelSelect.selectOption("Claude Sonnet");
  await expect(modelSelect).toHaveValue("Claude Sonnet");
  await fallbackProviderSelect.selectOption("anthropic");
  await expect(fallbackModelSelect).toHaveValue("Claude Opus");
  await fallbackModelSelect.selectOption("Claude Haiku");
  await expect(fallbackModelSelect).toHaveValue("Claude Haiku");

  await routingSwitch.click();
  await expect(routingSwitch).toHaveAttribute("aria-checked", "false");
  await expectSwitchThumbInsideTrack(routingSwitch);
  await expect(
    page.getByRole("heading", { exact: true, name: "카테고리별 모델 설정" })
  ).toHaveCount(0);
  await expect(providerSelect).toHaveCount(0);
  await expect(modelSelect).toHaveCount(0);
  await expect(offDefaultHeading).toBeVisible();
  await expect(offDefaultProviderSelect).toHaveValue("openai");
  await expect(offDefaultModelSelect).toHaveValue("GPT-4o");
  await expect(fallbackProviderSelect).toBeEnabled();
  await expect(fallbackModelSelect).toBeEnabled();

  const offDefaultCard = page.locator(".tenant-routing-off-default-card");
  const offAutoRoutingWidth = await getRenderedWidth(autoRoutingCard);
  const offDefaultWidth = await getRenderedWidth(offDefaultCard);
  const offFallbackWidth = await getRenderedWidth(fallbackCard);

  expect(Math.abs(onAutoRoutingWidth - offAutoRoutingWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(onCategoryModelWidth - offDefaultWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(onFallbackWidth - offFallbackWidth)).toBeLessThanOrEqual(1);

  const autoRoutingBounds = await autoRoutingCard.boundingBox();
  const offDefaultBounds = await offDefaultCard.boundingBox();

  expect(autoRoutingBounds).not.toBeNull();
  expect(offDefaultBounds).not.toBeNull();
  expect(offDefaultBounds!.y).toBeGreaterThan(autoRoutingBounds!.y + autoRoutingBounds!.height);

  await offDefaultProviderSelect.selectOption("google");
  await expect(offDefaultModelSelect).toHaveValue("Gemini Pro");

  await page.getByRole("button", { exact: true, name: "초기화" }).click();
  await expect(routingSwitch).toHaveAttribute("aria-checked", "true");
  await expect(offDefaultHeading).toHaveCount(0);
  await expect(
    page.getByRole("heading", { exact: true, name: "카테고리별 모델 설정" })
  ).toBeVisible();
  await expect(providerSelect).toBeEnabled();
  await expect(providerSelect).toHaveValue("openai");
  await expect(modelSelect).toHaveValue("GPT-4o");
  await expect(fallbackProviderSelect).toHaveValue("openai");
  await expect(fallbackModelSelect).toHaveValue("GPT-4o mini");
});

test("routing configuration stacks without horizontal overflow on mobile", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto(tenantManagementPath);
  await page.getByRole("tab", { exact: true, name: "라우팅" }).click();

  const routingPanel = page.locator(".tenant-routing-panel");
  await expect(routingPanel).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "변경사항 저장" })).toBeVisible();
  await page.getByRole("switch", { exact: true, name: "Auto routing" }).click();
  await expect(
    page.getByRole("heading", { exact: true, name: "Auto routing OFF 시 기본 모델" })
  ).toBeVisible();

  const panelWidth = await routingPanel.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth
  }));

  expect(panelWidth.scrollWidth).toBeLessThanOrEqual(panelWidth.clientWidth + 1);
});

async function expectSwitchThumbInsideTrack(switchControl: Locator) {
  const insets = await switchControl.evaluate((element) => {
    const thumb = element.querySelector('[data-slot="switch-thumb"]');

    if (!(thumb instanceof HTMLElement)) {
      throw new Error("Switch thumb not found");
    }

    const trackBounds = element.getBoundingClientRect();
    const thumbBounds = thumb.getBoundingClientRect();

    return {
      left: thumbBounds.left - trackBounds.left,
      right: trackBounds.right - thumbBounds.right
    };
  });

  expect(insets.left).toBeGreaterThanOrEqual(2);
  expect(insets.right).toBeGreaterThanOrEqual(2);
}

async function getRenderedWidth(locator: Locator) {
  const bounds = await locator.boundingBox();

  expect(bounds).not.toBeNull();

  return bounds!.width;
}
