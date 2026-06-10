import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_HOST: z.string().default('localhost'),
  DATABASE_PORT: z.coerce.number().int().positive().default(5432),
  DATABASE_USERNAME: z.string().default('operp'),
  DATABASE_PASSWORD: z.string().default('operp_secret'),
  DATABASE_NAME: z.string().default('operp'),
  VALKEY_HOST: z.string().default('localhost'),
  VALKEY_PORT: z.coerce.number().int().positive().default(6379),
  JWT_SECRET: z.string().min(32).default('test-jwt-secret-that-is-at-least-32-chars'),
  JWT_EXPIRES_IN: z.string().default('1d'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>) {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const messages = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
    throw new Error(`Environment validation failed:\n${messages.join('\n')}`);
  }
  return result.data;
}
