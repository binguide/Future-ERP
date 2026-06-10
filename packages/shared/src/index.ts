import { z } from 'zod';

export const TenantSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  domain: z.string().optional(),
  createdAt: z.date(),
});

export type Tenant = z.infer<typeof TenantSchema>;

export const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(1000).default(50),
});

export type Pagination = z.infer<typeof PaginationSchema>;
