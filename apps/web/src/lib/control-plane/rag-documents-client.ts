import "server-only";

import {
  getControlPlaneBaseUrl,
  resolveControlPlaneTenantId,
} from "@/lib/control-plane/control-plane-config";
import {
  buildControlPlaneHeaders,
  type ControlPlaneRequestOptions,
} from "@/lib/control-plane/control-plane-request";
import type {
  TenantRagDocument,
  TenantRagDocumentList,
} from "@/lib/control-plane/rag-documents-types";

export type RagDocumentsResult<T> =
  | { data: T; ok: true; status: number }
  | { error: string; ok: false; status: number };

export async function getTenantRagDocuments(
  routeTenantId: string,
  options?: ControlPlaneRequestOptions,
): Promise<RagDocumentsResult<TenantRagDocumentList>> {
  return requestRagDocuments(routeTenantId, options);
}

export async function deleteTenantRagDocument(
  routeTenantId: string,
  documentId: string,
  options?: ControlPlaneRequestOptions,
): Promise<RagDocumentsResult<TenantRagDocument>> {
  const tenantId = resolveControlPlaneTenantId(routeTenantId);

  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/tenants/${encodeURIComponent(tenantId)}/rag/documents/${encodeURIComponent(documentId)}`,
      {
        cache: "no-store",
        headers: await buildControlPlaneHeaders(options),
        method: "DELETE",
      },
    );
    const payload = (await response.json().catch(() => ({}))) as unknown;

    if (!response.ok) {
      return {
        error: readErrorMessage(payload, response.status),
        ok: false,
        status: response.status,
      };
    }
    const document = readRagDocumentEnvelope(payload);
    if (!document) {
      return {
        error: "Control Plane response did not include a valid RAG document.",
        ok: false,
        status: response.status,
      };
    }
    return { data: document, ok: true, status: response.status };
  } catch {
    return { error: "Control Plane unavailable.", ok: false, status: 0 };
  }
}

async function requestRagDocuments(
  routeTenantId: string,
  options?: ControlPlaneRequestOptions,
): Promise<RagDocumentsResult<TenantRagDocumentList>> {
  const tenantId = resolveControlPlaneTenantId(routeTenantId);

  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/tenants/${encodeURIComponent(tenantId)}/rag/documents`,
      {
        cache: "no-store",
        headers: await buildControlPlaneHeaders(options),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as unknown;
    if (!response.ok) {
      return {
        error: readErrorMessage(payload, response.status),
        ok: false,
        status: response.status,
      };
    }
    const list = readRagDocumentList(payload);
    if (!list) {
      return {
        error:
          "Control Plane response did not include a valid RAG document list.",
        ok: false,
        status: response.status,
      };
    }
    return { data: list, ok: true, status: response.status };
  } catch {
    return { error: "Control Plane unavailable.", ok: false, status: 0 };
  }
}

function readRagDocumentList(value: unknown): TenantRagDocumentList | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.data) || !record.data.every(isTenantRagDocument)) {
    return null;
  }
  const pagination = record.pagination;
  if (
    !pagination ||
    typeof pagination !== "object" ||
    Array.isArray(pagination)
  ) {
    return null;
  }
  const page = pagination as Record<string, unknown>;
  if (
    typeof page.hasMore !== "boolean" ||
    (page.nextCursor !== null && typeof page.nextCursor !== "string")
  ) {
    return null;
  }
  return {
    documents: record.data,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
  };
}

function readRagDocumentEnvelope(value: unknown): TenantRagDocument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return isTenantRagDocument((value as Record<string, unknown>).data)
    ? (value as Record<string, TenantRagDocument>).data
    : null;
}

function isTenantRagDocument(value: unknown): value is TenantRagDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const document = value as Record<string, unknown>;
  const uploadedBy = document.uploadedBy;
  return (
    typeof document.documentId === "string" &&
    typeof document.displayName === "string" &&
    (document.mimeType === "application/pdf" ||
      document.mimeType === "text/plain") &&
    typeof document.sizeBytes === "number" &&
    Number.isSafeInteger(document.sizeBytes) &&
    document.sizeBytes >= 0 &&
    typeof document.status === "string" &&
    [
      "UPLOADED",
      "EXTRACTING",
      "CHUNKING",
      "EMBEDDING",
      "INDEXING",
      "READY",
      "FAILED",
      "DELETING",
    ].includes(document.status) &&
    (document.failureCode === null ||
      typeof document.failureCode === "string") &&
    (document.failureMessage === null ||
      typeof document.failureMessage === "string") &&
    typeof document.createdAt === "string" &&
    typeof document.updatedAt === "string" &&
    Boolean(uploadedBy) &&
    typeof uploadedBy === "object" &&
    !Array.isArray(uploadedBy) &&
    ((uploadedBy as Record<string, unknown>).displayName === null ||
      typeof (uploadedBy as Record<string, unknown>).displayName === "string")
  );
}

function readErrorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim())
      return record.message;
    if (typeof record.error === "string" && record.error.trim())
      return record.error;
  }
  return `Control Plane request failed (${status}).`;
}
