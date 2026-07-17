import type { RagDocumentStatus } from "@/lib/control-plane/rag-documents-types";

export const MAX_RAG_DOCUMENT_UPLOAD_BYTES = 20 * 1024 * 1024;
export const RAG_DOCUMENT_POLL_INTERVAL_MS = 3_000;
export const RAG_DOCUMENT_POLL_MAX_ATTEMPTS = 40;

const processingStatuses = new Set<RagDocumentStatus>([
  "UPLOADED",
  "EXTRACTING",
  "CHUNKING",
  "EMBEDDING",
  "INDEXING",
  "DELETING",
]);

export type UploadValidationResult = { error: string | null };

export function validateRagDocumentUpload(file: File): UploadValidationResult {
  if (file.size === 0) return { error: "empty" };
  if (file.size > MAX_RAG_DOCUMENT_UPLOAD_BYTES) return { error: "too_large" };

  const extension = file.name.split(".").pop()?.toLowerCase();
  const allowedType =
    file.type === "text/plain" || file.type === "application/pdf" || !file.type;
  if ((extension !== "txt" && extension !== "pdf") || !allowedType) {
    return { error: "unsupported" };
  }
  return { error: null };
}

export function isRagDocumentProcessing(status: RagDocumentStatus) {
  return processingStatuses.has(status);
}

export function shouldPollRagDocuments(
  statuses: readonly RagDocumentStatus[],
  attempts: number,
) {
  return (
    attempts < RAG_DOCUMENT_POLL_MAX_ATTEMPTS &&
    statuses.some(isRagDocumentProcessing)
  );
}
