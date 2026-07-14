import { expect, type APIRequestContext, type Page, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

const controlPlaneBaseUrl = (
  process.env.GATELM_CONTROL_PLANE_BASE_URL ??
  process.env.CONTROL_PLANE_BASE_URL ??
  "http://localhost:3001"
).replace(/\/+$/, "");
const e2eBaseUrl =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3000"}`;

let sessionCookie = "";
let tenantId = "";

test.beforeAll(async ({ request }) => {
  ({ sessionCookie, tenantId } = await createConsoleSession(request));
});

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: "gatelm_locale",
      url: e2eBaseUrl,
      value: "en"
    },
    {
      name: "gatelm_session",
      url: e2eBaseUrl,
      value: sessionCookie
    }
  ]);
});

test("live logs fills the console width without shrinking text or overflowing the page", async ({
  page
}) => {
  await page.setViewportSize({ height: 1080, width: 1920 });
  await page.goto(`/tenants/${tenantId}/request-logs`);
  await expect(page.getByRole("heading", { exact: true, name: "Live Logs" })).toBeVisible();

  const desktop = await readRequestLogLayout(page);

  expect(desktop.heroWidth).toBeCloseTo(desktop.availableContentWidth, 0);
  expect(desktop.workspaceWidth).toBeCloseTo(desktop.availableContentWidth, 0);
  expect(desktop.headingFontSize).toBeGreaterThanOrEqual(28);
  expect(desktop.tableFontSize).toBeGreaterThanOrEqual(14);
  expect(desktop.pageScrollWidth).toBeLessThanOrEqual(desktop.pageClientWidth);

  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto(`/tenants/${tenantId}/request-logs`);
  await expect(page.getByRole("heading", { exact: true, name: "Live Logs" })).toBeVisible();

  const mobile = await readRequestLogLayout(page);

  expect(mobile.heroWidth).toBeCloseTo(mobile.availableContentWidth, 0);
  expect(mobile.workspaceWidth).toBeCloseTo(mobile.availableContentWidth, 0);
  expect(mobile.pageScrollWidth).toBeLessThanOrEqual(mobile.pageClientWidth);
  expect(mobile.tableScrollWidth).toBeGreaterThan(mobile.tableClientWidth);
});

async function readRequestLogLayout(page: Page) {
  return page.evaluate(() => {
    const screen = document.querySelector<HTMLElement>(".request-log-screen");
    const hero = document.querySelector<HTMLElement>(".request-log-hero");
    const workspace = document.querySelector<HTMLElement>(".request-log-workspace");
    const table = document.querySelector<HTMLElement>(".request-table");
    const tableWrap = document.querySelector<HTMLElement>(".request-log-list-panel > .table-wrap");

    if (!screen || !hero || !workspace || !table || !tableWrap) {
      throw new Error("Request log layout is incomplete.");
    }

    const screenStyle = getComputedStyle(screen);
    const availableContentWidth =
      screen.getBoundingClientRect().width -
      Number.parseFloat(screenStyle.paddingLeft) -
      Number.parseFloat(screenStyle.paddingRight);

    return {
      availableContentWidth,
      headingFontSize: Number.parseFloat(
        getComputedStyle(hero.querySelector("h2") as HTMLElement).fontSize
      ),
      heroWidth: hero.getBoundingClientRect().width,
      pageClientWidth: document.documentElement.clientWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      tableClientWidth: tableWrap.clientWidth,
      tableFontSize: Number.parseFloat(getComputedStyle(table).fontSize),
      tableScrollWidth: tableWrap.scrollWidth,
      workspaceWidth: workspace.getBoundingClientRect().width
    };
  });
}

async function createConsoleSession(request: APIRequestContext) {
  const email = `request-log-layout-${randomUUID()}@example.invalid`;
  const password = "correct-horse-battery-staple";
  const signupResponse = await request.post(`${controlPlaneBaseUrl}/api/auth/signup`, {
    data: {
      email,
      name: "Request Log Layout E2E",
      password
    }
  });

  expect(signupResponse.ok()).toBeTruthy();

  const organizationResponse = await request.post(
    `${controlPlaneBaseUrl}/api/auth/organizations`,
    {
      data: {
        organizationName: `Request Log Layout ${randomUUID().slice(0, 8)}`
      }
    }
  );

  expect(organizationResponse.ok()).toBeTruthy();

  const organizationPayload = (await organizationResponse.json()) as {
    data?: {
      tenant?: {
        id?: unknown;
      };
    };
  };
  const resolvedTenantId = organizationPayload.data?.tenant?.id;
  const resolvedSessionCookie = getSetCookieValue(
    organizationResponse.headersArray(),
    "gatelm_session"
  );

  expect(typeof resolvedTenantId).toBe("string");
  expect(resolvedSessionCookie).not.toBeNull();

  return {
    sessionCookie: resolvedSessionCookie ?? "",
    tenantId: String(resolvedTenantId)
  };
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
