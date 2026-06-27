"use client";

import { useState } from "react";
import type { CredentialIssueResponse } from "@/lib/fixtures/v1-admin-fixtures";

type CredentialOneTimeSecretProps = {
  credentialName: string;
  issueResponse: CredentialIssueResponse;
};

export function CredentialOneTimeSecret({
  credentialName,
  issueResponse
}: CredentialOneTimeSecretProps) {
  const [isStored, setIsStored] = useState(false);

  return (
    <section className="one-time-secret" data-hidden={isStored}>
      <div>
        <p className="console-kicker">one-time issue response</p>
        <h4>{credentialName} plaintext</h4>
        <p>{issueResponse.warning}</p>
      </div>
      {isStored ? (
        <div className="secret-placeholder">
          Plaintext hidden after first view. Use prefix and last4 for lookup.
        </div>
      ) : (
        <>
          <code>{issueResponse.plaintext}</code>
          <button className="primary-button" onClick={() => setIsStored(true)} type="button">
            Mark stored
          </button>
        </>
      )}
    </section>
  );
}
