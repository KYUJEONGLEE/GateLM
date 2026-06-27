import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(_context: ExecutionContext): boolean {
    const authMode = this.config.get<string>('CONTROL_PLANE_ADMIN_AUTH_MODE');

    if (authMode === 'demo_admin_placeholder') {
      return true;
    }

    throw new UnauthorizedException('Unsupported Control Plane admin auth mode.');
  }
}
