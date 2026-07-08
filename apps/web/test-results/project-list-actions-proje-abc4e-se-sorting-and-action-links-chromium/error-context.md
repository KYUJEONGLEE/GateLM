# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: project-list-actions.spec.ts >> project cards expose sorting and action links
- Location: e2e\project-list-actions.spec.ts:6:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator: getByRole('button', { name: 'Usage', exact: true })
Expected: "true"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for getByRole('button', { name: 'Usage', exact: true })

```

```yaml
- main:
  - navigation "GateLM landing navigation":
    - link "GateLM home":
      - /url: /
      - text: G
      - strong: GateLM
    - link "AI Gateway":
      - /url: "#gateway"
    - link "정책":
      - /url: "#policies"
    - link "연동":
      - /url: "#integrations"
    - link "회사 소개":
      - /url: "#company"
    - button "English"
    - button "한국어" [pressed]
    - button "로그인"
    - button "회원가입"
  - heading "기업의 LLM 사용을 운영 가능한 Gateway로 전환합니다." [level=1]
  - paragraph: 고객사의 기존 서비스와 사내 UI를 유지한 채 모든 LLM 요청을 하나의 Gateway로 통과시켜 비용, 정책, 로그, 보안을 운영 레벨에서 관리합니다.
  - region "연동 가능한 AI Provider":
    - strong: 연동 가능한 AI Provider
    - text: OpenAI Anthropic Google Gemini Cohere Azure OpenAI AWS Bedrock
  - paragraph: About GateLM
  - heading "기업의 AI 사용을 막지 않고, 운영 가능한 형태로 바꿉니다." [level=2]
  - paragraph: GateLM은 직원과 서비스가 이미 사용하던 LLM 흐름을 유지하면서 관리자가 비용과 보안 정책을 한 곳에서 제어하도록 돕는 B2B LLMOps Gateway입니다.
  - button "대시보드로 이동"
  - button "직원 Chat 확인"
  - heading "Gateway 한 곳에서 비용, 모델, 보안 정책을 관리합니다." [level=2]
  - paragraph: 서비스마다 흩어진 Provider 호출, API Key, 로그, 예산 정책을 Gateway 계층에서 표준화합니다.
  - article:
    - strong: Unified API
    - paragraph: OpenAI 호환 API 하나로 여러 Provider와 모델을 연결합니다.
  - article:
    - strong: Spend Tracking
    - paragraph: 테넌트, 프로젝트, 애플리케이션, budget scope 단위로 토큰과 비용을 추적합니다.
  - article:
    - strong: Smart Cache
    - paragraph: 반복 요청은 exact cache 경로로 응답해 Provider 호출 비용을 줄입니다.
  - article:
    - strong: Model Access
    - paragraph: 팀과 서비스가 사용할 수 있는 Provider, 모델, 예산 경계를 제어합니다.
  - heading "운영 정책은 코드 배포 없이 콘솔에서 변경합니다." [level=2]
  - paragraph: 관리자는 예산, rate limit, masking, routing 정책을 scope별로 분리하고 RuntimeSnapshot으로 publish할 수 있습니다.
  - article:
    - strong: Budget Policy
    - paragraph: 예산 임계값을 설정해 과금 급증을 Provider 호출 전에 차단합니다.
  - article:
    - strong: Security Policy
    - paragraph: request-side masking을 적용하고 민감한 evidence는 sanitized 형태로 유지합니다.
  - article:
    - strong: Routing Policy
    - paragraph: 비용, 지연 시간, Provider 상태, 애플리케이션 맥락에 따라 모델을 선택합니다.
  - heading "고객 UI는 그대로 두고, LLM 요청만 GateLM으로 보냅니다." [level=2]
  - paragraph: 직원은 익숙한 제품 화면을 계속 사용하고, 고객 서버는 scope가 정해진 application credential로 GateLM Gateway를 호출합니다.
  - list:
    - listitem: Owner/Admin이 tenant, project, application을 생성합니다.
    - listitem: Provider credential과 GateLM application token을 등록합니다.
    - listitem: 고객 서버가 Provider 직접 호출 대신 Gateway를 호출합니다.
    - listitem: Dashboard, request log, policy event에서 결과를 한 곳에 확인합니다.
  - heading "운영자는 통제하고, 직원은 하던 대로 사용합니다." [level=2]
  - paragraph: GateLM은 직원 경험을 바꾸지 않고 LLM 사용을 운영 가능한 레이어로 묶습니다.
  - button "콘솔 열기"
- alert
```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | 
  3  | const tenantId = "tenant_demo_acme";
  4  | const projectsPath = `/tenants/${tenantId}/projects`;
  5  | 
  6  | test("project cards expose sorting and action links", async ({ page }) => {
  7  |   await page.goto(projectsPath);
  8  | 
  9  |   const usageSort = page.getByRole("button", { exact: true, name: "Usage" });
  10 |   const budgetSort = page.getByRole("button", { exact: true, name: "Budget" });
  11 | 
> 12 |   await expect(usageSort).toHaveAttribute("aria-pressed", "true");
     |                           ^ Error: expect(locator).toHaveAttribute(expected) failed
  13 |   await budgetSort.click();
  14 |   await expect(budgetSort).toHaveAttribute("aria-pressed", "true");
  15 | 
  16 |   const projectCard = page.getByTestId("project-card").first();
  17 |   const editProjectLink = projectCard.getByRole("link", { exact: true, name: "Edit project" });
  18 |   const policyPattern = new RegExp(`^${escapeRegExp(projectsPath)}/[^/]+/policies$`);
  19 | 
  20 |   await expect(projectCard.getByRole("link", { exact: true, name: "Edit" })).toHaveCount(0);
  21 |   await expect(projectCard.getByRole("link", { exact: true, name: "Edit policy" })).toHaveCount(0);
  22 |   await expect(editProjectLink).toHaveAttribute("href", policyPattern);
  23 |   await expect(projectCard).not.toHaveAttribute("role", "link");
  24 |   await expect(projectCard).not.toHaveAttribute("tabindex", "0");
  25 | 
  26 |   const editProjectHref = await editProjectLink.getAttribute("href");
  27 | 
  28 |   expect(editProjectHref).toBeTruthy();
  29 |   expect(editProjectHref).not.toContain("/applications/");
  30 | 
  31 |   await projectCard.getByRole("heading").click();
  32 |   await expect(page).toHaveURL(new RegExp(`${escapeRegExp(projectsPath)}$`));
  33 | 
  34 |   await editProjectLink.click();
  35 |   await expect(page).toHaveURL(new RegExp(`${escapeRegExp(projectsPath)}/[^/]+/policies$`));
  36 |   await expect(page.getByRole("tab", { exact: true, name: "General" })).toHaveAttribute(
  37 |     "aria-selected",
  38 |     "true"
  39 |   );
  40 | });
  41 | 
  42 | function escapeRegExp(value: string) {
  43 |   return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  44 | }
  45 | 
```