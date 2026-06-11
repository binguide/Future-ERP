import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  async login(email: string, password: string, tenant: string) {
    const user = await this.userService.validatePassword(email, password);
    if (!user) {
      return null;
    }

    const payload = { sub: user.id, email: user.email, role: user.role, tenant };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }
}
