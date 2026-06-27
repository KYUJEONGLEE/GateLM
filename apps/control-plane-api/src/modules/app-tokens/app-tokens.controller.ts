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

import { AppTokensService } from './app-tokens.service';
import {
  AppTokenListItemDto,
  AppTokenRevokedResponseDto,
  IssueAppTokenDto,
  ListAppTokensQueryDto,
  OneTimeAppTokenResponseDto,
} from './dto/app-token.dto';

@UseGuards(AdminAuthGuard)
@Controller('admin/v1')
export class AppTokensController {
  constructor(private readonly appTokensService: AppTokensService) {}

  @Post('applications/:applicationId/app-tokens')
  async issueAppToken(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() body: IssueAppTokenDto,
  ): Promise<DataEnvelope<OneTimeAppTokenResponseDto>> {
    return {
      data: await this.appTokensService.issueAppToken(applicationId, body),
    };
  }

  @Get('applications/:applicationId/app-tokens')
  async listAppTokens(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Query() query: ListAppTokensQueryDto,
  ): Promise<ListEnvelope<AppTokenListItemDto>> {
    return this.appTokensService.listAppTokens(applicationId, query);
  }

  @Post('app-tokens/:appTokenId/rotate')
  @HttpCode(HttpStatus.OK)
  async rotateAppToken(
    @Param('appTokenId', ParseUUIDPipe) appTokenId: string,
  ): Promise<DataEnvelope<OneTimeAppTokenResponseDto>> {
    return {
      data: await this.appTokensService.rotateAppToken(appTokenId),
    };
  }

  @Post('app-tokens/:appTokenId/revoke')
  @HttpCode(HttpStatus.OK)
  async revokeAppToken(
    @Param('appTokenId', ParseUUIDPipe) appTokenId: string,
  ): Promise<DataEnvelope<AppTokenRevokedResponseDto>> {
    return {
      data: await this.appTokensService.revokeAppToken(appTokenId),
    };
  }
}
