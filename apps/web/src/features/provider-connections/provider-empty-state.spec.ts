import { expect, test } from "@playwright/test";
import { getProviderEmptyStateGuide } from "./provider-empty-state";

test("provides a three-step first provider guide in each locale", () => {
  const englishGuide = getProviderEmptyStateGuide("en");
  const koreanGuide = getProviderEmptyStateGuide("ko");

  expect(englishGuide.title).toBe("Connect your first provider");
  expect(englishGuide.steps).toHaveLength(3);
  expect(englishGuide.steps.map((step) => step.title)).toEqual([
    "Choose a provider",
    "Add credentials",
    "Connect models"
  ]);

  expect(koreanGuide.title).toBe("첫 Provider를 연결해 모델 사용을 준비하세요");
  expect(koreanGuide.steps).toHaveLength(3);
  expect(koreanGuide.steps.map((step) => step.title)).toEqual([
    "Provider 선택",
    "인증 정보 등록",
    "모델 연결"
  ]);
});
