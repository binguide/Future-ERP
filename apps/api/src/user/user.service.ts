import { Injectable, ConflictException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { User } from '../entities/user.entity';
import { TenantContextService } from '../tenant/tenant-context.service';

@Injectable()
export class UserService {
  constructor(private readonly ctx: TenantContextService) {}

  // `users` is a tenant-scoped table; resolve the repo from the request's
  // pinned connection so it hits the tenant schema, not the shared pool.
  private get userRepo() {
    return this.ctx.getRepository(User);
  }

  async create(email: string, name: string, password: string): Promise<User> {
    const existing = await this.userRepo.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already exists');
    }
    const passwordHash = await argon2.hash(password);
    const user = this.userRepo.create({ email, name, passwordHash });
    return this.userRepo.save(user);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { email } });
  }

  async validatePassword(
    email: string,
    password: string,
  ): Promise<User | null> {
    const user = await this.findByEmail(email);
    if (!user) return null;
    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) return null;
    return user;
  }
}
