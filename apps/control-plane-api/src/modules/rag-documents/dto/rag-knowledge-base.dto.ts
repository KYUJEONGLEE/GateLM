import { IsBoolean } from 'class-validator';

export class UpdateRagKnowledgeBaseDto {
  @IsBoolean()
  enabled!: boolean;
}

// Keep the query contract closed so tenantId, knowledgeBaseId, and other
// client-provided scope overrides are rejected by the global ValidationPipe.
export class NoRagKnowledgeBaseQueryDto {}

export interface RagKnowledgeBaseResponseDto {
  tenantEnabled: boolean;
  globalEnabled: boolean;
  effectiveEnabled: boolean;
}
