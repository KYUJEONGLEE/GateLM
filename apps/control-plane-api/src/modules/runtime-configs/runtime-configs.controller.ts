import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';

import {
  ActiveRuntimeConfigResponseDto,
  PublishRuntimeConfigDto,
  ProviderCatalogResponseDto,
  RuntimeConfigDraftResponseDto,
  RuntimeSnapshotResponseDto,
  UpsertRuntimeConfigDraftDto,
} from './dto/runtime-config.dto';
import { RuntimeConfigsService } from './runtime-configs.service';

@UseGuards(AdminAuthGuard)
@Controller('admin/v1')
export class RuntimeConfigsController {
  constructor(private readonly runtimeConfigsService: RuntimeConfigsService) {}

  @Get('applications/:applicationId/runtime-config/active')
  async getActiveRuntimeConfig(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<ActiveRuntimeConfigResponseDto> {
    return this.runtimeConfigsService.getActiveRuntimeConfig(applicationId);
  }

  @Get('applications/:applicationId/runtime-snapshot/active')
  async getActiveRuntimeSnapshot(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<RuntimeSnapshotResponseDto> {
    return this.runtimeConfigsService.getActiveRuntimeSnapshot(applicationId);
  }

  @Get('applications/:applicationId/provider-catalog/active')
  async getActiveProviderCatalog(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<ProviderCatalogResponseDto> {
    return this.runtimeConfigsService.getActiveProviderCatalog(applicationId);
  }

  @Get('provider-catalogs/:catalogId')
  async getProviderCatalog(
    @Param('catalogId') catalogId: string,
  ): Promise<ProviderCatalogResponseDto> {
    return this.runtimeConfigsService.getProviderCatalog(catalogId);
  }

  @Post('applications/:applicationId/runtime-config/draft')
  @HttpCode(HttpStatus.OK)
  async upsertDraft(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() body: UpsertRuntimeConfigDraftDto,
  ): Promise<RuntimeConfigDraftResponseDto> {
    return this.runtimeConfigsService.upsertDraft(applicationId, body);
  }

  @Post('applications/:applicationId/runtime-config/publish')
  @HttpCode(HttpStatus.OK)
  async publishRuntimeConfig(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() body: PublishRuntimeConfigDto,
  ): Promise<ActiveRuntimeConfigResponseDto> {
    return this.runtimeConfigsService.publishRuntimeConfig(
      applicationId,
      body,
    );
  }
}
