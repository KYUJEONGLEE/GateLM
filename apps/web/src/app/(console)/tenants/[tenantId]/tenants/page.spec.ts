import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const pageSourceUrl = new URL("./page.tsx", import.meta.url);

test("tenant routing page keeps the requested copy contract", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");

  expect(pageSource).toContain("Tenant 관리");
  expect(pageSource).toContain("Auto routing");
  expect(pageSource).toContain("카테고리별 모델 설정");
  expect(pageSource).toContain("추천 모델 자동 설정");
  expect(pageSource).toContain("data-recommendation-highlighted");
  expect(pageSource).toContain("data-save-confirmed");
  expect(pageSource).toContain('"저장됨"');
  expect(pageSource).toContain("고성능 모델");
  expect(pageSource).toContain("Fallback 모델 설정");
  expect(pageSource).toContain("Auto routing OFF 시 기본 모델");
  expect(pageSource).not.toContain("자동 분류");
  expect(pageSource).not.toContain("분류되지 않은 요청");
  expect(pageSource).not.toContain("분류 기준");
  expect(pageSource).not.toContain('<span role="columnheader">Fallback 모델</span>');
});

test("tenant routing page renders all requested display categories", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");

  for (const category of ["일반 채팅", "코드 생성", "번역", "요약 / 문서", "추론"]) {
    expect(pageSource).toContain(category);
  }
  expect(pageSource).not.toContain("검색 / RAG");
});
