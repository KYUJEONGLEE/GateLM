import { HttpException, HttpStatus } from '@nestjs/common';

export type RagUploadErrorCode =
  | 'RAG_UPLOAD_ABORTED'
  | 'RAG_UPLOAD_CONFIGURATION_INVALID'
  | 'RAG_UPLOAD_DISPLAY_NAME_INVALID'
  | 'RAG_UPLOAD_EMPTY_FILE'
  | 'RAG_UPLOAD_FILE_REQUIRED'
  | 'RAG_UPLOAD_FILE_TOO_LARGE'
  | 'RAG_UPLOAD_FILENAME_INVALID'
  | 'RAG_UPLOAD_MIME_MISMATCH'
  | 'RAG_UPLOAD_MULTIPLE_FILES'
  | 'RAG_UPLOAD_MULTIPART_INVALID'
  | 'RAG_UPLOAD_SIGNATURE_INVALID'
  | 'RAG_UPLOAD_STORAGE_UNAVAILABLE'
  | 'RAG_UPLOAD_TEXT_ENCODING_INVALID'
  | 'RAG_UPLOAD_UNEXPECTED_FIELD'
  | 'RAG_UPLOAD_UNSUPPORTED_FILE_TYPE';

interface RagUploadErrorDefinition {
  message: string;
  status: HttpStatus;
}

const DEFINITIONS: Readonly<Record<RagUploadErrorCode, RagUploadErrorDefinition>> = {
  RAG_UPLOAD_ABORTED: {
    message: 'The upload request was interrupted.',
    status: HttpStatus.BAD_REQUEST,
  },
  RAG_UPLOAD_CONFIGURATION_INVALID: {
    message: 'RAG upload configuration is invalid.',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
  },
  RAG_UPLOAD_DISPLAY_NAME_INVALID: {
    message: 'The document display name is invalid.',
    status: HttpStatus.BAD_REQUEST,
  },
  RAG_UPLOAD_EMPTY_FILE: {
    message: 'The uploaded file is empty.',
    status: HttpStatus.BAD_REQUEST,
  },
  RAG_UPLOAD_FILE_REQUIRED: {
    message: 'A document file is required.',
    status: HttpStatus.BAD_REQUEST,
  },
  RAG_UPLOAD_FILE_TOO_LARGE: {
    message: 'The uploaded file exceeds the configured size limit.',
    status: HttpStatus.PAYLOAD_TOO_LARGE,
  },
  RAG_UPLOAD_FILENAME_INVALID: {
    message: 'The uploaded filename is invalid.',
    status: HttpStatus.BAD_REQUEST,
  },
  RAG_UPLOAD_MIME_MISMATCH: {
    message: 'The file extension and content type do not match.',
    status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  },
  RAG_UPLOAD_MULTIPLE_FILES: {
    message: 'Exactly one document file is allowed.',
    status: HttpStatus.BAD_REQUEST,
  },
  RAG_UPLOAD_MULTIPART_INVALID: {
    message: 'The multipart upload request is invalid.',
    status: HttpStatus.BAD_REQUEST,
  },
  RAG_UPLOAD_SIGNATURE_INVALID: {
    message: 'The uploaded file content does not match its declared type.',
    status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  },
  RAG_UPLOAD_STORAGE_UNAVAILABLE: {
    message: 'Document storage is temporarily unavailable.',
    status: HttpStatus.SERVICE_UNAVAILABLE,
  },
  RAG_UPLOAD_TEXT_ENCODING_INVALID: {
    message: 'Text documents must contain valid UTF-8 without NUL bytes.',
    status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  },
  RAG_UPLOAD_UNEXPECTED_FIELD: {
    message: 'The multipart upload contains an unsupported field.',
    status: HttpStatus.BAD_REQUEST,
  },
  RAG_UPLOAD_UNSUPPORTED_FILE_TYPE: {
    message: 'Only TXT and PDF documents are supported.',
    status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  },
};

/** A stable, filename-free error safe for the global HTTP exception filter. */
export class RagUploadException extends HttpException {
  override readonly name = 'RagUploadException';

  constructor(readonly code: RagUploadErrorCode) {
    const definition = DEFINITIONS[code];
    super({ code, message: definition.message }, definition.status);
  }
}
