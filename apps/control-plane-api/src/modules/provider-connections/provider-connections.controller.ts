import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import { DataEnvelope, ListEnvelope } from '@/common/types/envelope';

import {
  ListProvidersQueryDto,
  ProviderModelDiscoveryResponseDto,
  ProviderResponseDto,
  UpsertProviderDto,
} from './dto/provider-connection.dto';
import { ProviderConnectionsService } from './provider-connections.service';

@UseGuards(AdminAuthGuard)
@Controller('admin/v1')
export class ProviderConnectionsController {
  constructor(
    private readonly providerConnectionsService: ProviderConnectionsService,
  ) {}

  @Post('projects/:projectId/providers')
  @HttpCode(HttpStatus.OK)
  async upsertProvider(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: UpsertProviderDto,
  ): Promise<DataEnvelope<ProviderResponseDto>> {
    return {
      data: await this.providerConnectionsService.upsertProvider(
        projectId,
        body,
      ),
    };
  }

  @Get('projects/:projectId/providers')
  async listProviders(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListProvidersQueryDto,
  ): Promise<ListEnvelope<ProviderResponseDto>> {
    return this.providerConnectionsService.listProviders(projectId, query);
  }

  @Post('projects/:projectId/providers/:provider/discover-models')
  @HttpCode(HttpStatus.OK)
  async discoverProviderModels(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('provider') provider: string,
  ): Promise<DataEnvelope<ProviderModelDiscoveryResponseDto>> {
    return {
      data: await this.providerConnectionsService.discoverProviderModels(
        projectId,
        provider,
      ),
    };
  }
}
