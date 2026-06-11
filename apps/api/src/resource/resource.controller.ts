import { Controller, Get, Post, Put, Param, Body, NotFoundException, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CaslGuard } from '../auth/casl.guard';
import { ResourceService } from './resource.service';
import { Request } from 'express';

@UseGuards(AuthGuard('jwt'), CaslGuard)
@Controller('resource')
export class ResourceController {
  constructor(private readonly resourceService: ResourceService) {}

  @Get(':doctype')
  async list(@Param('doctype') doctype: string, @Req() req: Request) {
    const userId = (req.user as any)?.sub;
    return this.resourceService.list(doctype, userId);
  }

  @Get(':doctype/:id')
  async get(@Param('doctype') doctype: string, @Param('id') id: string, @Req() req: Request) {
    const userId = (req.user as any)?.sub;
    const doc = await this.resourceService.get(doctype, id, userId);
    if (!doc) {
      throw new NotFoundException();
    }
    return doc;
  }

  @Post(':doctype')
  async create(@Param('doctype') doctype: string, @Body() data: Record<string, unknown>) {
    return this.resourceService.create(doctype, data);
  }

  @Put(':doctype/:id')
  async update(
    @Param('doctype') doctype: string,
    @Param('id') id: string,
    @Body() data: Record<string, unknown>,
  ) {
    const doc = await this.resourceService.update(doctype, id, data);
    if (!doc) {
      throw new NotFoundException();
    }
    return doc;
  }
}
