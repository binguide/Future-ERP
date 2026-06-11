import { Controller, Get, Post, Put, Param, Body, NotFoundException } from '@nestjs/common';
import { ResourceService } from './resource.service';

@Controller('resource')
export class ResourceController {
  constructor(private readonly resourceService: ResourceService) {}

  @Get(':doctype')
  async list(@Param('doctype') doctype: string) {
    return this.resourceService.list(doctype);
  }

  @Get(':doctype/:id')
  async get(@Param('doctype') doctype: string, @Param('id') id: string) {
    const doc = await this.resourceService.get(doctype, id);
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
