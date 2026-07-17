export const RAG_DOCUMENT_STATUSES = [
  "UPLOADED",
  "EXTRACTING",
  "CHUNKING",
  "EMBEDDING",
  "INDEXING",
  "READY",
  "FAILED",
  "DELETING",
] as const;

export type RagDocumentStatus = (typeof RAG_DOCUMENT_STATUSES)[number];

export type TenantRagDocument = {
  createdAt: string;
  displayName: string;
  documentId: string;
  failureCode: string | null;
  failureMessage: string | null;
  mimeType: "application/pdf" | "text/plain";
  sizeBytes: number;
  status: RagDocumentStatus;
  updatedAt: string;
  uploadedBy: {
    displayName: string | null;
  };
};

export type TenantRagDocumentList = {
  documents: TenantRagDocument[];
  hasMore: boolean;
  nextCursor: string | null;
};
