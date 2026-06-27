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

import { ApiKeysService } from './api-keys.service';
import {
  ApiKeyListItemDto,
  CredentialRevokedResponseDto,
  IssueApiKeyDto,
  ListApiKeysQueryDto,
  OneTimeApiKeyResponseDto,
} from './dto/api-key.dto';

@UseGuards(AdminAuthGuard)
@Controller('admin/v1')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post('projects/:projectId/api-keys')
  async issueApiKey(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: IssueApiKeyDto,
  ): Promise<DataEnvelope<OneTimeApiKeyResponseDto>> {
    return {
      data: await this.apiKeysService.issueApiKey(projectId, body),
    };
  }

  @Get('projects/:projectId/api-keys')
  async listApiKeys(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListApiKeysQueryDto,
  ): Promise<ListEnvelope<ApiKeyListItemDto>> {
    return this.apiKeysService.listApiKeys(projectId, query);
  }

  @Post('api-keys/:apiKeyId/rotate')
  @HttpCode(HttpStatus.OK)
  async rotateApiKey(
    @Param('apiKeyId', ParseUUIDPipe) apiKeyId: string,
  ): Promise<DataEnvelope<OneTimeApiKeyResponseDto>> {
    return {
      data: await this.apiKeysService.rotateApiKey(apiKeyId),
    };
  }

  @Post('api-keys/:apiKeyId/revoke')
  @HttpCode(HttpStatus.OK)
  async revokeApiKey(
    @Param('apiKeyId', ParseUUIDPipe) apiKeyId: string,
  ): Promise<DataEnvelope<CredentialRevokedResponseDto>> {
    return {
      data: await this.apiKeysService.revokeApiKey(apiKeyId),
    };
  }
}
