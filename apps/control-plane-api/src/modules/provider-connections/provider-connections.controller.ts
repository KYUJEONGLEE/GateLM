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
  ListProviderPresetsQueryDto,
  ListProvidersQueryDto,
  ProviderModelDiscoveryResponseDto,
  ProviderPresetResponseDto,
  ProviderResponseDto,
  SetApplicationProvidersDto,
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

  @Post('tenants/:tenantId/providers')
  @HttpCode(HttpStatus.OK)
  async upsertTenantProvider(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() body: UpsertProviderDto,
  ): Promise<DataEnvelope<ProviderResponseDto>> {
    return {
      data: await this.providerConnectionsService.upsertTenantProvider(
        tenantId,
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

  @Get('tenants/:tenantId/providers')
  async listTenantProviders(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: ListProvidersQueryDto,
  ): Promise<ListEnvelope<ProviderResponseDto>> {
    return this.providerConnectionsService.listTenantProviders(tenantId, query);
  }

  @Get('applications/:applicationId/providers')
  async listApplicationProviders(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<ListEnvelope<ProviderResponseDto>> {
    return this.providerConnectionsService.listApplicationProviders(
      applicationId,
    );
  }

  @Post('applications/:applicationId/providers')
  @HttpCode(HttpStatus.OK)
  async setApplicationProviders(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() body: SetApplicationProvidersDto,
  ): Promise<ListEnvelope<ProviderResponseDto>> {
    return this.providerConnectionsService.setApplicationProviders(
      applicationId,
      body,
    );
  }

  @Get('provider-presets')
  async listProviderPresets(
    @Query() query: ListProviderPresetsQueryDto,
  ): Promise<ListEnvelope<ProviderPresetResponseDto>> {
    return this.providerConnectionsService.listProviderPresets(query);
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

  @Post('tenants/:tenantId/providers/:provider/discover-models')
  @HttpCode(HttpStatus.OK)
  async discoverTenantProviderModels(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('provider') provider: string,
  ): Promise<DataEnvelope<ProviderModelDiscoveryResponseDto>> {
    return {
      data: await this.providerConnectionsService.discoverTenantProviderModels(
        tenantId,
        provider,
      ),
    };
  }
}
