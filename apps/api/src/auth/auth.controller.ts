import { Controller, Post, Body, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import '../tenant/tenant-request';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(
    @Body('email') email: string,
    @Body('password') password: string,
    @Req() req: Request,
  ) {
    if (!email || !password) {
      throw new UnauthorizedException('Email and password are required');
    }

    const tenantSchema = req.tenantSchema;
    if (!tenantSchema) {
      throw new UnauthorizedException('Tenant not resolved');
    }

    const result = await this.authService.login(email, password, tenantSchema);
    if (!result) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return result;
  }
}
