import { Copy } from "lucide-react";
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
    response: string;
  }
> = {
  en: {
    hidden: "Plaintext hidden. Only prefix and last4 remain available.",
    response: "one-time issue response"
  },
  ko: {
    hidden: "원문은 숨겨졌습니다. 이제 prefix와 last4만 확인할 수 있습니다.",
    response: "1회 발급 응답"
  }
};

export function CredentialOneTimeSecret({
  credentialName,
  issueResponse,
  locale
}: CredentialOneTimeSecretProps) {
  const text = secretText[locale];
  const copyLabel = `Copy ${credentialName}`;
  const [hasCopied, setHasCopied] = useState(false);
  const isHidden = !issueResponse.plaintext.trim();

  async function copyPlaintext() {
    if (isHidden || !navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(issueResponse.plaintext);
      setHasCopied(true);
    } catch {
      setHasCopied(false);
    }
  }

  return (
    <section className="one-time-secret" data-hidden={isHidden}>
      <div>
        <p className="console-kicker">{text.response}</p>
      </div>
      {isHidden ? (
        <div className="secret-placeholder">
          <span>{text.hidden}</span>
          <code>{`${issueResponse.prefix}...${issueResponse.last4}`}</code>
        </div>
      ) : (
        <div className="one-time-secret-value-row">
          <code>{issueResponse.plaintext}</code>
          <button
            aria-label={copyLabel}
            className="one-time-secret-copy-button"
            data-copied={hasCopied}
            onClick={() => void copyPlaintext()}
            title={copyLabel}
            type="button"
          >
            <Copy aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
}
