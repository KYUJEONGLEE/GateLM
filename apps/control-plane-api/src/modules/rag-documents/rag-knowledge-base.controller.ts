import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import type { DataEnvelope } from '@/common/types/envelope';

import {
  NoRagKnowledgeBaseQueryDto,
  type RagKnowledgeBaseResponseDto,
  UpdateRagKnowledgeBaseDto,
} from './dto/rag-knowledge-base.dto';
import { RagKnowledgeBaseService } from './rag-knowledge-base.service';

@Controller('admin/v1/tenants/:tenantId/rag/knowledge-base')
@UseGuards(AdminAuthGuard)
export class RagKnowledgeBaseController {
  constructor(private readonly service: RagKnowledgeBaseService) {}

  @Get()
  async getSettings(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() _query: NoRagKnowledgeBaseQueryDto,
  ): Promise<DataEnvelope<RagKnowledgeBaseResponseDto>> {
    return { data: await this.service.getSettings(tenantId) };
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  async updateSettings(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() _query: NoRagKnowledgeBaseQueryDto,
    @Body() body: UpdateRagKnowledgeBaseDto,
  ): Promise<DataEnvelope<RagKnowledgeBaseResponseDto>> {
    return { data: await this.service.updateSettings(tenantId, body.enabled) };
  }
}
