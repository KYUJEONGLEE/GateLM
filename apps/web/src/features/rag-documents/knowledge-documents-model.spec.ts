import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

import {
  MAX_RAG_DOCUMENT_UPLOAD_BYTES,
  RAG_DOCUMENT_POLL_MAX_ATTEMPTS,
  shouldPollRagDocuments,
  validateRagDocumentUpload,
} from "./knowledge-documents-model";

test("accepts non-empty TXT and PDF uploads within the client-side size limit", () => {
  expect(
    validateRagDocumentUpload(
      new File(["policy"], "policy.txt", { type: "text/plain" }),
    ),
  ).toEqual({ error: null });
  expect(
    validateRagDocumentUpload(
      new File(["%PDF"], "policy.pdf", { type: "application/pdf" }),
    ),
  ).toEqual({ error: null });
});

test("rejects unsupported, empty, and oversized uploads before network submission", () => {
  expect(
    validateRagDocumentUpload(
      new File([], "empty.txt", { type: "text/plain" }),
    ),
  ).toEqual({ error: "empty" });
  expect(
    validateRagDocumentUpload(
      new File(["binary"], "photo.png", { type: "image/png" }),
    ),
  ).toEqual({ error: "unsupported" });
  expect(
    validateRagDocumentUpload(
      new File(
        [new Uint8Array(MAX_RAG_DOCUMENT_UPLOAD_BYTES + 1)],
        "large.txt",
        { type: "text/plain" },
      ),
    ),
  ).toEqual({ error: "too_large" });
});

test("polls only while server-side processing or deletion is active and stops at the cap", () => {
  expect(shouldPollRagDocuments(["READY", "FAILED"], 0)).toBe(false);
  expect(shouldPollRagDocuments(["UPLOADED"], 0)).toBe(true);
  expect(shouldPollRagDocuments(["DELETING"], 3)).toBe(true);
  expect(
    shouldPollRagDocuments(["EMBEDDING"], RAG_DOCUMENT_POLL_MAX_ATTEMPTS),
  ).toBe(false);
});

test("the RAG documents UI preserves server authorization and never renders internal fields", async () => {
  const componentSource = await readFile(
    new URL("./knowledge-documents.tsx", import.meta.url),
    "utf8",
  );
  const pageSource = await readFile(
    new URL(
      "../../app/(console)/tenants/[tenantId]/knowledge-documents/page.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const bffSource = await readFile(
    new URL(
      "../../app/api/control-plane/rag-documents/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const shellSource = await readFile(
    new URL("../../components/layout/console-shell.tsx", import.meta.url),
    "utf8",
  );

  expect(componentSource).toContain("XMLHttpRequest");
  expect(componentSource).toContain("RAG_DOCUMENT_POLL_INTERVAL_MS");
  expect(componentSource).toContain("DialogContent");
  expect(componentSource).not.toContain("s3ObjectKey");
  expect(componentSource).not.toContain("kms");
  expect(componentSource).not.toContain("embedding");
  expect(pageSource).toContain("isTenantAdminForTenant(auth, tenantId)");
  expect(bffSource).toContain("isTenantAdminForTenant(auth, routeTenantId)");
  expect(bffSource).toContain(
    "resolveConsoleTenantIdForAuth(auth, routeTenantId)",
  );
  expect(shellSource).toContain("adminOnly: true");
  expect(shellSource).toContain(
    "!child.adminOnly || canManageKnowledgeDocuments",
  );
});
