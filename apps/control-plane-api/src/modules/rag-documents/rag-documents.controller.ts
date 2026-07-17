import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { CurrentAdminUserId } from '@/common/authenticated-admin';
import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import type { DataEnvelope, ListEnvelope } from '@/common/types/envelope';

import {
  ListRagDocumentsQueryDto,
  NoRagDocumentQueryDto,
  type RagDocumentResponseDto,
} from './dto/rag-document.dto';
import { RagDocumentsService } from './rag-documents.service';

@Controller('admin/v1/tenants/:tenantId/rag/documents')
@UseGuards(AdminAuthGuard)
export class RagDocumentsController {
  constructor(private readonly service: RagDocumentsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async upload(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @CurrentAdminUserId() uploadedByUserId: string,
    @Query() _query: NoRagDocumentQueryDto,
    @Req() request: Request,
  ): Promise<DataEnvelope<RagDocumentResponseDto>> {
    return {
      data: await this.service.upload(tenantId, uploadedByUserId, request),
    };
  }

  @Get()
  async list(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: ListRagDocumentsQueryDto,
  ): Promise<ListEnvelope<RagDocumentResponseDto>> {
    return this.service.list(tenantId, query);
  }

  @Get(':documentId')
  async getStatus(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Query() _query: NoRagDocumentQueryDto,
  ): Promise<DataEnvelope<RagDocumentResponseDto>> {
    return { data: await this.service.getStatus(tenantId, documentId) };
  }

  @Delete(':documentId')
  @HttpCode(HttpStatus.ACCEPTED)
  async delete(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Query() _query: NoRagDocumentQueryDto,
  ): Promise<DataEnvelope<RagDocumentResponseDto>> {
    return { data: await this.service.requestDelete(tenantId, documentId) };
  }
}
