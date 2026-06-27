"use client";

import { useState } from "react";
import type { CredentialIssueResponse } from "@/lib/fixtures/v1-admin-fixtures";
import type { Locale } from "@/lib/i18n/locale";

type CredentialOneTimeSecretProps = {
  credentialName: string;
  issueResponse: CredentialIssueResponse;
  locale: Locale;
};

const secretText: Record<
  Locale,
  {
    hidden: string;
    markStored: string;
    plaintext: string;
    response: string;
  }
> = {
  en: {
    hidden: "Plaintext hidden after first view. Use prefix and last4 for lookup.",
    markStored: "Mark stored",
    plaintext: "plaintext",
    response: "one-time issue response"
  },
  ko: {
    hidden: "첫 확인 이후 원문은 숨깁니다. 조회에는 prefix와 last4만 사용합니다.",
    markStored: "저장 완료 처리",
    plaintext: "원문",
    response: "1회 발급 응답"
  }
};

export function CredentialOneTimeSecret({
  credentialName,
  issueResponse,
  locale
}: CredentialOneTimeSecretProps) {
  const [isStored, setIsStored] = useState(false);
  const text = secretText[locale];

  return (
    <section className="one-time-secret" data-hidden={isStored}>
      <div>
        <p className="console-kicker">{text.response}</p>
        <h4>
          {credentialName} {text.plaintext}
        </h4>
        <p>{issueResponse.warning}</p>
      </div>
      {isStored ? (
        <div className="secret-placeholder">{text.hidden}</div>
      ) : (
        <>
          <code>{issueResponse.plaintext}</code>
          <button className="primary-button" onClick={() => setIsStored(true)} type="button">
            {text.markStored}
          </button>
        </>
      )}
    </section>
  );
}
