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
    plaintext: string;
    response: string;
  }
> = {
  en: {
    plaintext: "plaintext",
    response: "one-time issue response"
  },
  ko: {
    plaintext: "원문",
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

  async function copyPlaintext() {
    if (!navigator.clipboard) {
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
    <section className="one-time-secret">
      <div>
        <p className="console-kicker">{text.response}</p>
        <h4>
          {credentialName} {text.plaintext}
        </h4>
      </div>
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
    </section>
  );
}
