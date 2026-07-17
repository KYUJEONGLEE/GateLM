import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListRagDocumentsQueryDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @IsUUID()
  cursor?: string;
}

// Binding an explicit empty DTO makes the global forbidNonWhitelisted pipe
// reject every query parameter on routes whose contract has no query shape.
export class NoRagDocumentQueryDto {}

export interface RagDocumentResponseDto {
  documentId: string;
  displayName: string;
  mimeType: 'application/pdf' | 'text/plain';
  sizeBytes: number;
  status: string;
  failureCode: string | null;
  failureMessage: string | null;
  uploadedBy: {
    displayName: string | null;
  };
  createdAt: string;
  updatedAt: string;
}
