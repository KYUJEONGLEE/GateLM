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

  return (
    <section className="one-time-secret">
      <div>
        <p className="console-kicker">{text.response}</p>
        <h4>
          {credentialName} {text.plaintext}
        </h4>
      </div>
      <code>{issueResponse.plaintext}</code>
    </section>
  );
}
