import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page
} from "@playwright/test";

const tenantManagementPath = "/tenants/tenant_demo_acme/tenants";
const testBaseUrl =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
const controlPlaneBaseUrl = (
  process.env.GATELM_CONTROL_PLANE_BASE_URL ??
  process.env.CONTROL_PLANE_BASE_URL ??
  "http://localhost:3001"
).replace(/\/+$/, "");

test.beforeEach(async ({ context, request }) => {
  const sessionCookie = await createConsoleSessionCookie(request);

  await context.addCookies([
    {
      name: "gatelm_session",
      url: testBaseUrl,
      value: sessionCookie
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
  ).toHaveCount(0);
  await expect(
    routingPanel.getByRole("heading", { exact: true, name: "Fallback 모델 설정" })
  ).toBeVisible();
  await expect(
    routingPanel.getByRole("heading", { exact: true, name: "Auto routing OFF 시 기본 모델" })
  ).toBeVisible();
  await expect(routingPanel.locator(".tenant-routing-section-divider")).toBeVisible();

  const routingSwitch = routingPanel.getByRole("switch", { exact: true, name: "Auto routing" });
  await expect(routingSwitch).toHaveAttribute("aria-checked", "false");
  await expectSwitchThumbInsideTrack(routingSwitch);
  await expect(
    routingPanel.getByRole("button", { exact: true, name: "추천 모델 자동 설정" })
  ).toHaveCount(0);
  await expect(
    routingPanel.getByRole("button", { exact: true, name: "변경사항 저장" })
  ).toHaveCSS("background-color", "rgb(16, 163, 127)");

  await routingSwitch.click();
  await expect(routingSwitch).toHaveAttribute("aria-checked", "true");
  await expect(routingSwitch).toHaveCSS("background-color", "rgb(16, 163, 127)");
  await expectSwitchThumbInsideTrack(routingSwitch);
  await expect(
    routingPanel.getByRole("heading", { exact: true, name: "카테고리별 모델 설정" })
  ).toBeVisible();
  await expect(
    routingPanel.getByRole("heading", { exact: true, name: "Auto routing OFF 시 기본 모델" })
  ).toHaveCount(0);
  const recommendationButton = routingPanel.getByRole("button", {
    exact: true,
    name: "추천 모델 자동 설정"
  });
  await expect(recommendationButton).toBeVisible();
  await expect(recommendationButton).toHaveCSS("background-color", "rgb(16, 163, 127)");
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

});

test("first ON copies the OFF default and recommendation applies configured routes", async ({
  page
}) => {
  await page.goto(tenantManagementPath);
  await page.getByRole("tab", { exact: true, name: "라우팅" }).click();

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

  await expect(offDefaultHeading).toBeVisible();
  await expect(routingSwitch).toHaveAttribute("aria-checked", "false");
  await offDefaultProviderSelect.selectOption("anthropic");
  await expect(offDefaultModelSelect).toHaveValue("Claude Opus");
  await offDefaultModelSelect.selectOption("Claude Haiku");

  await routingSwitch.click();
  await expect(routingSwitch).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("heading", { exact: true, name: "카테고리별 모델 설정" })
  ).toBeVisible();
  await expectAllRoutingRoutes(page, { model: "Claude Haiku", provider: "anthropic" });

  await page.getByRole("button", { exact: true, name: "추천 모델 자동 설정" }).click();

  const highlightedRoutes = page.locator(
    '.tenant-routing-route[data-recommendation-highlighted="true"]'
  );
  await expect(highlightedRoutes).toHaveCount(10);
  await expect(highlightedRoutes.first()).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)"
  );
  await expectRecommendedRoutingRoutes(page);
  await expect(highlightedRoutes).toHaveCount(0, { timeout: 3500 });

  await page.getByRole("button", { exact: true, name: "추천 모델 자동 설정" }).click();
  await expect(highlightedRoutes).toHaveCount(10);
  await expect(page.getByRole("status")).toHaveText("추천 모델 설정을 다시 적용했습니다.");
  await expect(highlightedRoutes).toHaveCount(0, { timeout: 3500 });
});

test("subsequent OFF and ON restores the existing routing rows", async ({ page }) => {
  await page.goto(tenantManagementPath);

  const routingSwitch = page.getByRole("switch", { exact: true, name: "Auto routing" });
  await routingSwitch.click();
  await page.getByRole("button", { exact: true, name: "추천 모델 자동 설정" }).click();
  await expectRecommendedRoutingRoutes(page);

  await page.getByLabel("일반 채팅 기본 모델 모델", { exact: true }).selectOption("GPT-4.1");
  await routingSwitch.click();
  await page
    .getByLabel("Auto routing OFF 기본 Provider", { exact: true })
    .selectOption("google");
  await page
    .getByLabel("Auto routing OFF 기본 모델 선택", { exact: true })
    .selectOption("Gemini Flash");

  await routingSwitch.click();

  await expect(page.getByLabel("일반 채팅 기본 모델 제공자", { exact: true })).toHaveValue(
    "openai"
  );
  await expect(page.getByLabel("일반 채팅 기본 모델 모델", { exact: true })).toHaveValue(
    "GPT-4.1"
  );
  await expect(page.getByLabel("추론 고성능 모델 제공자", { exact: true })).toHaveValue(
    "anthropic"
  );
  await expect(page.getByLabel("추론 고성능 모델 모델", { exact: true })).toHaveValue(
    "Claude Opus"
  );
});

test("save confirms the click and restores saved settings after a tab round trip", async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(tenantManagementPath);

  const routingSwitch = page.getByRole("switch", { exact: true, name: "Auto routing" });
  await routingSwitch.click();

  await page
    .getByLabel("일반 채팅 기본 모델 제공자", { exact: true })
    .selectOption("anthropic");
  await page
    .getByLabel("일반 채팅 기본 모델 모델", { exact: true })
    .selectOption("Claude Sonnet");
  await page
    .getByLabel("일반 채팅 고성능 모델 제공자", { exact: true })
    .selectOption("google");
  await page
    .getByLabel("일반 채팅 고성능 모델 모델", { exact: true })
    .selectOption("Gemini Flash");
  await page.getByLabel("Fallback Provider", { exact: true }).selectOption("google");
  await page.getByLabel("Fallback 모델 선택", { exact: true }).selectOption("Gemini Flash");

  const saveButton = page.locator(".tenant-routing-save-button");
  await saveButton.evaluate((element) => {
    element.setAttribute("data-test-save-animation-starts", "0");
    element.addEventListener("animationstart", (event) => {
      if (
        event.target !== element ||
        (event as AnimationEvent).animationName !== "tenant-routing-save-confirmation"
      ) {
        return;
      }
      const currentCount = Number(element.getAttribute("data-test-save-animation-starts")) || 0;
      element.setAttribute("data-test-save-animation-starts", String(currentCount + 1));
    });
  });
  await expect(saveButton).toHaveText("변경사항 저장");
  await saveButton.click();
  await expect(saveButton).toHaveAttribute("data-save-confirmed", "true");
  await expect(saveButton).toHaveText("저장됨");
  await expect(saveButton).toHaveCSS("animation-name", "tenant-routing-save-confirmation");
  await expect(saveButton).toHaveAttribute("data-test-save-animation-starts", "1");
  await expect(page.getByRole("status")).toHaveText("변경사항을 저장했습니다.");

  await saveButton.click();
  await expect(saveButton).toHaveAttribute("data-save-confirmed", "true");
  await expect(saveButton).toHaveAttribute("data-test-save-animation-starts", "2");

  await page
    .getByLabel("일반 채팅 기본 모델 모델", { exact: true })
    .selectOption("Claude Haiku");
  await expect(saveButton).toHaveText("변경사항 저장");
  await expect(saveButton).not.toHaveAttribute("data-save-confirmed", "true");

  await page.getByRole("tab", { exact: true, name: "예산" }).click();
  await expect(page.locator(".tenant-routing-panel")).toHaveCount(0);
  await page.getByRole("tab", { exact: true, name: "라우팅" }).click();

  await expect(routingSwitch).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("일반 채팅 기본 모델 제공자", { exact: true })).toHaveValue(
    "anthropic"
  );
  await expect(page.getByLabel("일반 채팅 기본 모델 모델", { exact: true })).toHaveValue(
    "Claude Sonnet"
  );
  await expect(page.getByLabel("일반 채팅 고성능 모델 제공자", { exact: true })).toHaveValue(
    "google"
  );
  await expect(page.getByLabel("일반 채팅 고성능 모델 모델", { exact: true })).toHaveValue(
    "Gemini Flash"
  );
  await expect(page.getByLabel("Fallback Provider", { exact: true })).toHaveValue("google");
  await expect(page.getByLabel("Fallback 모델 선택", { exact: true })).toHaveValue(
    "Gemini Flash"
  );
});

test("reset while ON keeps ON and restores the current OFF default model", async ({ page }) => {
  await page.goto(tenantManagementPath);

  const routingSwitch = page.getByRole("switch", { exact: true, name: "Auto routing" });
  const offDefaultProviderSelect = page.getByLabel("Auto routing OFF 기본 Provider", {
    exact: true
  });
  const offDefaultModelSelect = page.getByLabel("Auto routing OFF 기본 모델 선택", {
    exact: true
  });

  await offDefaultProviderSelect.selectOption("google");
  await offDefaultModelSelect.selectOption("Gemini Flash");
  await routingSwitch.click();
  await page.getByRole("button", { exact: true, name: "추천 모델 자동 설정" }).click();
  await page.getByRole("button", { exact: true, name: "초기화" }).click();

  await expect(routingSwitch).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("heading", { exact: true, name: "카테고리별 모델 설정" })
  ).toBeVisible();
  await expectAllRoutingRoutes(page, { model: "Gemini Flash", provider: "google" });
  await expect(page.getByRole("status")).toHaveText(
    "모든 카테고리 모델을 OFF 기본 모델로 초기화했습니다."
  );

  await routingSwitch.click();
  await expect(offDefaultProviderSelect).toHaveValue("google");
  await expect(offDefaultModelSelect).toHaveValue("Gemini Flash");
  await routingSwitch.click();
  await expectAllRoutingRoutes(page, { model: "Gemini Flash", provider: "google" });
});

test("reset while OFF clears the first-ON initialization state", async ({ page }) => {
  await page.goto(tenantManagementPath);

  const routingSwitch = page.getByRole("switch", { exact: true, name: "Auto routing" });
  const offDefaultProviderSelect = page.getByLabel("Auto routing OFF 기본 Provider", {
    exact: true
  });
  const offDefaultModelSelect = page.getByLabel("Auto routing OFF 기본 모델 선택", {
    exact: true
  });

  await offDefaultProviderSelect.selectOption("google");
  await page.getByRole("button", { exact: true, name: "초기화" }).click();

  await expect(routingSwitch).toHaveAttribute("aria-checked", "false");
  await expect(offDefaultProviderSelect).toHaveValue("openai");
  await expect(offDefaultModelSelect).toHaveValue("GPT-4o");

  await offDefaultProviderSelect.selectOption("anthropic");
  await offDefaultModelSelect.selectOption("Claude Haiku");
  await routingSwitch.click();

  await expectAllRoutingRoutes(page, { model: "Claude Haiku", provider: "anthropic" });
});

test("routing configuration stacks without horizontal overflow on mobile", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto(tenantManagementPath);
  await page.getByRole("tab", { exact: true, name: "라우팅" }).click();

  const routingPanel = page.locator(".tenant-routing-panel");
  await expect(routingPanel).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "변경사항 저장" })).toBeVisible();
  await expect(
    page.getByRole("heading", { exact: true, name: "Auto routing OFF 시 기본 모델" })
  ).toBeVisible();
  await expectNoHorizontalOverflow(routingPanel);

  await page.getByRole("switch", { exact: true, name: "Auto routing" }).click();
  await expect(
    page.getByRole("button", { exact: true, name: "추천 모델 자동 설정" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { exact: true, name: "카테고리별 모델 설정" })
  ).toBeVisible();
  await expectNoHorizontalOverflow(routingPanel);
});

const routingCategories = ["일반 채팅", "코드 생성", "번역", "요약 / 문서", "추론"] as const;
const routingColumns = ["기본 모델", "고성능 모델"] as const;
const recommendedRoutes = [
  {
    category: "일반 채팅",
    defaultRoute: { model: "GPT-4o", provider: "openai" },
    highQualityRoute: { model: "Claude Sonnet", provider: "anthropic" }
  },
  {
    category: "코드 생성",
    defaultRoute: { model: "Claude Opus", provider: "anthropic" },
    highQualityRoute: { model: "GPT-4o", provider: "openai" }
  },
  {
    category: "번역",
    defaultRoute: { model: "Gemini Pro", provider: "google" },
    highQualityRoute: { model: "GPT-4o", provider: "openai" }
  },
  {
    category: "요약 / 문서",
    defaultRoute: { model: "Gemini Flash", provider: "google" },
    highQualityRoute: { model: "GPT-4o mini", provider: "openai" }
  },
  {
    category: "추론",
    defaultRoute: { model: "Claude Sonnet", provider: "anthropic" },
    highQualityRoute: { model: "Claude Opus", provider: "anthropic" }
  }
] as const;

async function expectAllRoutingRoutes(
  page: Page,
  expected: { model: string; provider: string }
) {
  for (const category of routingCategories) {
    for (const column of routingColumns) {
      await expect(page.getByLabel(`${category} ${column} 제공자`, { exact: true })).toHaveValue(
        expected.provider
      );
      await expect(page.getByLabel(`${category} ${column} 모델`, { exact: true })).toHaveValue(
        expected.model
      );
    }
  }
}

async function expectRecommendedRoutingRoutes(page: Page) {
  for (const route of recommendedRoutes) {
    await expectRoutingRoute(page, route.category, "기본 모델", route.defaultRoute);
    await expectRoutingRoute(page, route.category, "고성능 모델", route.highQualityRoute);
  }
}

async function expectRoutingRoute(
  page: Page,
  category: string,
  column: string,
  expected: { model: string; provider: string }
) {
  await expect(page.getByLabel(`${category} ${column} 제공자`, { exact: true })).toHaveValue(
    expected.provider
  );
  await expect(page.getByLabel(`${category} ${column} 모델`, { exact: true })).toHaveValue(
    expected.model
  );
}

async function expectNoHorizontalOverflow(locator: Locator) {
  const width = await locator.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth
  }));

  expect(width.scrollWidth).toBeLessThanOrEqual(width.clientWidth + 1);
}

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

async function createConsoleSessionCookie(request: APIRequestContext) {
  const signupResponse = await request.post(`${controlPlaneBaseUrl}/api/auth/signup`, {
    data: {
      email: `tenant-routing-e2e-${randomUUID()}@example.invalid`,
      name: "Tenant Routing E2E",
      password: "correct-horse-battery-staple"
    }
  });

  expect(signupResponse.ok()).toBeTruthy();

  const organizationResponse = await request.post(
    `${controlPlaneBaseUrl}/api/auth/organizations`,
    {
      data: {
        organizationName: `Tenant Routing E2E ${randomUUID().slice(0, 8)}`
      }
    }
  );

  expect(organizationResponse.ok()).toBeTruthy();

  const sessionCookie = getSetCookieValue(organizationResponse.headersArray(), "gatelm_session");
  if (!sessionCookie) {
    throw new Error("Control plane did not issue a gatelm_session cookie.");
  }

  return sessionCookie;
}

function getSetCookieValue(headers: { name: string; value: string }[], cookieName: string) {
  for (const header of headers) {
    if (header.name.toLowerCase() !== "set-cookie") {
      continue;
    }

    const [nameValue] = header.value.split(";");
    const separatorIndex = nameValue.indexOf("=");
    const name = separatorIndex >= 0 ? nameValue.slice(0, separatorIndex).trim() : "";
    const value = separatorIndex >= 0 ? nameValue.slice(separatorIndex + 1).trim() : "";

    if (name === cookieName) {
      return value;
    }
  }

  return null;
}
