"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  LoaderCircle,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  RAG_DOCUMENT_POLL_INTERVAL_MS,
  shouldPollRagDocuments,
  validateRagDocumentUpload,
} from "@/features/rag-documents/knowledge-documents-model";
import type { TenantRagDocument } from "@/lib/control-plane/rag-documents-types";
import type { Locale } from "@/lib/i18n/locale";

type KnowledgeDocumentsProps = {
  initialDocuments: TenantRagDocument[];
  initialLoadError: string | null;
  locale: Locale;
  tenantId: string;
};

type Feedback = {
  message: string;
  variant: "destructive" | "success" | "warning";
} | null;

const copy = {
  en: {
    breadcrumbManagement: "Management",
    breadcrumbTitle: "Knowledge Documents",
    cancel: "Cancel",
    createdAt: "Created",
    delete: "Delete document",
    deleteConfirm: "Delete permanently",
    deleteDescription:
      "This permanently deletes the source file and every indexed chunk. Existing chat messages remain, but their citation can no longer open this document.",
    deleteTitle: "Delete this knowledge document?",
    deleting: "Deleting…",
    description:
      "Upload tenant knowledge documents for employees to use when they explicitly choose Knowledge Chat.",
    document: "Document",
    empty: "No knowledge documents have been uploaded yet.",
    failed: "Document processing failed",
    fileHint:
      "TXT or text-based PDF, up to 20 MB. Scanned and image-only PDFs are not supported because OCR is disabled.",
    loadError: "Knowledge documents could not be loaded.",
    manualRefresh: "Refresh list",
    processing: "Processing",
    refresh: "Refresh",
    retryPolling: "Check again",
    size: "Size",
    status: "Status",
    title: "Knowledge Documents",
    type: "Type",
    upload: "Upload document",
    uploadError: "Document upload failed.",
    uploading: "Uploading…",
    uploadedBy: "Uploaded by",
    pollingPaused:
      "Processing is still running. Automatic checks paused; refresh to check again.",
    uploadProgress: "Upload progress",
  },
  ko: {
    breadcrumbManagement: "관리",
    breadcrumbTitle: "지식 문서",
    cancel: "취소",
    createdAt: "생성 시각",
    delete: "문서 삭제",
    deleteConfirm: "영구 삭제",
    deleteDescription:
      "원문 파일과 모든 색인 청크가 영구 삭제됩니다. 기존 채팅 메시지는 남지만 이 문서의 citation은 더 이상 열 수 없습니다.",
    deleteTitle: "이 지식 문서를 삭제할까요?",
    deleting: "삭제 요청 중…",
    description:
      "직원이 명시적으로 지식 채팅을 선택했을 때 사용할 tenant 지식 문서를 관리합니다.",
    document: "문서",
    empty: "업로드한 지식 문서가 없습니다.",
    failed: "문서 처리에 실패했습니다",
    fileHint:
      "TXT 또는 텍스트 기반 PDF, 최대 20MB입니다. OCR을 지원하지 않아 스캔·이미지 PDF는 지원하지 않습니다.",
    loadError: "지식 문서를 불러오지 못했습니다.",
    manualRefresh: "목록 새로고침",
    processing: "처리 중",
    refresh: "새로고침",
    retryPolling: "다시 확인",
    size: "크기",
    status: "상태",
    title: "지식 문서",
    type: "형식",
    upload: "문서 업로드",
    uploadError: "문서 업로드에 실패했습니다.",
    uploading: "업로드 중…",
    uploadedBy: "업로드 관리자",
    pollingPaused:
      "문서 처리가 계속 진행 중입니다. 자동 확인은 멈췄으니 새로고침해 상태를 확인하세요.",
    uploadProgress: "업로드 진행률",
  },
} satisfies Record<Locale, Record<string, string>>;

export function KnowledgeDocuments({
  initialDocuments,
  initialLoadError,
  locale,
  tenantId,
}: KnowledgeDocumentsProps) {
  const text = copy[locale];
  const [documents, setDocuments] = useState(initialDocuments);
  const [loadError, setLoadError] = useState(initialLoadError);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [pollAttempts, setPollAttempts] = useState(0);
  const [deleteCandidate, setDeleteCandidate] =
    useState<TenantRagDocument | null>(null);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  const hasProcessingDocuments = documents.some((document) =>
    isProcessing(document.status),
  );
  const pollingEnabled = shouldPollRagDocuments(
    documents.map((document) => document.status),
    pollAttempts,
  );

  const refreshDocuments = useCallback(
    async (options: { incrementPollAttempts?: boolean } = {}) => {
      const response = await fetch(documentApiUrl(tenantId), {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok || !isRagDocumentList(payload)) {
        setLoadError(readPayloadError(payload, text.loadError));
        if (options.incrementPollAttempts)
          setPollAttempts((current) => current + 1);
        return;
      }
      setDocuments(payload.documents);
      setLoadError(null);
      setPollAttempts(
        options.incrementPollAttempts ? (current) => current + 1 : 0,
      );
    },
    [tenantId, text.loadError],
  );

  useEffect(() => {
    if (!pollingEnabled) return;

    const timer = window.setTimeout(() => {
      void refreshDocuments({ incrementPollAttempts: true });
    }, RAG_DOCUMENT_POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [pollAttempts, pollingEnabled, refreshDocuments]);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const validation = validateRagDocumentUpload(file);
    if (validation.error) {
      setFeedback({
        message: uploadValidationMessage(validation.error, locale),
        variant: "destructive",
      });
      event.target.value = "";
      return;
    }
    void uploadDocument(file);
  }

  function uploadDocument(file: File) {
    setUploading(true);
    setUploadProgress(0);
    setFeedback(null);
    const formData = new FormData();
    formData.append("file", file);
    const request = new XMLHttpRequest();
    request.open("POST", documentApiUrl(tenantId));
    request.responseType = "json";
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setUploadProgress(
          Math.min(100, Math.round((event.loaded / event.total) * 100)),
        );
      }
    };
    request.onload = () => {
      const payload = request.response as unknown;
      if (request.status < 200 || request.status >= 300) {
        setFeedback({
          message: readPayloadError(payload, text.uploadError),
          variant: "destructive",
        });
      } else {
        setFeedback({
          message:
            locale === "ko"
              ? "문서를 업로드했습니다. 처리 상태를 확인합니다."
              : "Document uploaded. Checking processing status.",
          variant: "success",
        });
        setPollAttempts(0);
        void refreshDocuments();
      }
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    };
    request.onerror = () => {
      setFeedback({ message: text.uploadError, variant: "destructive" });
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    };
    request.send(formData);
  }

  async function confirmDelete() {
    if (!deleteCandidate || deletingDocumentId) return;
    setDeletingDocumentId(deleteCandidate.documentId);
    setFeedback(null);
    const response = await fetch(
      `${documentApiUrl(tenantId)}&documentId=${encodeURIComponent(deleteCandidate.documentId)}`,
      { method: "DELETE" },
    );
    const payload = (await response.json().catch(() => ({}))) as unknown;
    if (!response.ok || !isRagDocument(payload)) {
      setFeedback({
        message: readPayloadError(
          payload,
          locale === "ko"
            ? "문서 삭제 요청에 실패했습니다."
            : "Document deletion request failed.",
        ),
        variant: "destructive",
      });
      setDeletingDocumentId(null);
      return;
    }
    setDocuments((current) =>
      current.map((document) =>
        document.documentId === payload.documentId ? payload : document,
      ),
    );
    setDeleteCandidate(null);
    setDeletingDocumentId(null);
    setPollAttempts(0);
  }

  return (
    <main className="console-content management-line-content space-y-5">
      <Breadcrumb
        items={[
          { label: text.breadcrumbManagement },
          { label: text.breadcrumbTitle },
        ]}
      />
      <section className="dashboard-hero flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2>{text.title}</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {text.description}
          </p>
        </div>
        <Button disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <Upload aria-hidden="true" />
          )}
          {uploading ? text.uploading : text.upload}
        </Button>
        <input
          accept=".txt,.pdf,text/plain,application/pdf"
          aria-label={text.upload}
          className="sr-only"
          disabled={uploading}
          onChange={handleFileChange}
          ref={inputRef}
          type="file"
        />
      </section>

      <Alert variant="neutral">
        <FileText aria-hidden="true" />
        <AlertDescription>{text.fileHint}</AlertDescription>
      </Alert>

      {uploading ? (
        <div
          aria-label={text.uploadProgress}
          className="rounded-lg border bg-muted/30 p-3 text-sm"
        >
          <div className="mb-2 flex justify-between gap-4">
            <span>{text.uploading}</span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      ) : null}

      {loadError ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>{text.loadError}</AlertTitle>
          <AlertDescription>
            <p>{loadError}</p>
            <Button
              onClick={() => void refreshDocuments()}
              size="sm"
              variant="outline"
            >
              <RefreshCw aria-hidden="true" />
              {text.refresh}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {feedback ? (
        <Alert variant={feedback.variant}>
          {feedback.variant === "success" ? (
            <CheckCircle2 aria-hidden="true" />
          ) : (
            <AlertTriangle aria-hidden="true" />
          )}
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      ) : null}
      {hasProcessingDocuments && !pollingEnabled ? (
        <Alert variant="warning">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription>
            <p>{text.pollingPaused}</p>
            <Button
              onClick={() => void refreshDocuments()}
              size="sm"
              variant="outline"
            >
              {text.retryPolling}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{text.document}</CardTitle>
          <CardDescription>
            {hasProcessingDocuments ? text.processing : text.description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {text.empty}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{text.document}</th>
                    <th className="px-3 py-2 font-medium">{text.type}</th>
                    <th className="px-3 py-2 font-medium">{text.size}</th>
                    <th className="px-3 py-2 font-medium">{text.uploadedBy}</th>
                    <th className="px-3 py-2 font-medium">{text.createdAt}</th>
                    <th className="px-3 py-2 font-medium">{text.status}</th>
                    <th aria-label={text.delete} className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {documents.map((document) => (
                    <tr
                      className="border-b last:border-0"
                      key={document.documentId}
                    >
                      <td className="max-w-72 px-3 py-3 align-top">
                        <p className="break-words font-medium">
                          {document.displayName}
                        </p>
                        {document.status === "FAILED" &&
                        document.failureMessage ? (
                          <p className="mt-1 text-xs text-destructive">
                            {document.failureMessage}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 align-top text-muted-foreground">
                        {document.mimeType === "application/pdf"
                          ? "PDF"
                          : "TXT"}
                      </td>
                      <td className="px-3 py-3 align-top text-muted-foreground">
                        {formatBytes(document.sizeBytes, locale)}
                      </td>
                      <td className="px-3 py-3 align-top text-muted-foreground">
                        {document.uploadedBy.displayName ?? "-"}
                      </td>
                      <td className="px-3 py-3 align-top text-muted-foreground">
                        {formatDate(document.createdAt, locale)}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <DocumentStatusBadge
                          locale={locale}
                          status={document.status}
                        />
                      </td>
                      <td className="px-3 py-3 align-top">
                        <Button
                          aria-label={`${text.delete}: ${document.displayName}`}
                          disabled={
                            document.status === "DELETING" ||
                            deletingDocumentId === document.documentId
                          }
                          onClick={() => setDeleteCandidate(document)}
                          size="icon-sm"
                          variant="ghost"
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        onOpenChange={(open) =>
          !open && !deletingDocumentId && setDeleteCandidate(null)
        }
        open={Boolean(deleteCandidate)}
      >
        <DialogContent showClose={!deletingDocumentId}>
          <DialogHeader>
            <DialogTitle>{text.deleteTitle}</DialogTitle>
            <DialogDescription>{text.deleteDescription}</DialogDescription>
          </DialogHeader>
          {deleteCandidate ? (
            <p className="rounded-md bg-muted px-3 py-2 text-sm font-medium break-words">
              {deleteCandidate.displayName}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={Boolean(deletingDocumentId)}
              onClick={() => setDeleteCandidate(null)}
              variant="outline"
            >
              {text.cancel}
            </Button>
            <Button
              disabled={Boolean(deletingDocumentId)}
              onClick={() => void confirmDelete()}
              variant="destructive"
            >
              {deletingDocumentId ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : (
                <Trash2 aria-hidden="true" />
              )}
              {deletingDocumentId ? text.deleting : text.deleteConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function DocumentStatusBadge({
  locale,
  status,
}: {
  locale: Locale;
  status: TenantRagDocument["status"];
}) {
  const labels: Record<TenantRagDocument["status"], Record<Locale, string>> = {
    UPLOADED: { en: "Uploaded", ko: "업로드됨" },
    EXTRACTING: { en: "Extracting", ko: "텍스트 추출 중" },
    CHUNKING: { en: "Chunking", ko: "청크 생성 중" },
    EMBEDDING: { en: "Embedding", ko: "임베딩 생성 중" },
    INDEXING: { en: "Indexing", ko: "색인 생성 중" },
    READY: { en: "Ready", ko: "준비됨" },
    FAILED: { en: "Failed", ko: "실패" },
    DELETING: { en: "Deleting", ko: "삭제 중" },
  };
  const variant =
    status === "READY"
      ? "success"
      : status === "FAILED"
        ? "destructive"
        : status === "DELETING"
          ? "warning"
          : "neutral";
  return <Badge variant={variant}>{labels[status][locale]}</Badge>;
}

function documentApiUrl(tenantId: string) {
  return `/api/control-plane/rag-documents?tenantId=${encodeURIComponent(tenantId)}`;
}

function isRagDocumentList(
  value: unknown,
): value is { documents: TenantRagDocument[] } {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as Record<string, unknown>).documents),
  );
}

function isRagDocument(value: unknown): value is TenantRagDocument {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as Record<string, unknown>).documentId === "string",
  );
}

function isProcessing(status: TenantRagDocument["status"]) {
  return status !== "READY" && status !== "FAILED";
}

function readPayloadError(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    const error = record.error;
    if (typeof error === "string" && error.trim()) return error;
    const message = record.message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function uploadValidationMessage(error: string, locale: Locale) {
  const messages = {
    empty: {
      en: "Select a non-empty document.",
      ko: "비어 있지 않은 문서를 선택하세요.",
    },
    too_large: {
      en: "The document must be 20 MB or smaller.",
      ko: "문서는 20MB 이하여야 합니다.",
    },
    unsupported: {
      en: "Only TXT and PDF documents are supported.",
      ko: "TXT와 PDF 문서만 지원합니다.",
    },
  } as const;
  return (
    messages[error as keyof typeof messages]?.[locale] ??
    messages.unsupported[locale]
  );
}

function formatBytes(value: number, locale: Locale) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024)
    return `${new Intl.NumberFormat(locale === "ko" ? "ko-KR" : "en-US", { maximumFractionDigits: 1 }).format(value / 1024)} KB`;
  return `${new Intl.NumberFormat(locale === "ko" ? "ko-KR" : "en-US", { maximumFractionDigits: 1 }).format(value / (1024 * 1024))} MB`;
}

function formatDate(value: string, locale: Locale) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}
