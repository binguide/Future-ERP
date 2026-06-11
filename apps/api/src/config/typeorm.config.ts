import { DataSource, DataSourceOptions } from 'typeorm';
import { entities } from '../entities';
import { envSchema } from './env.schema';
import { config } from 'dotenv';

config();

const env = envSchema.parse(process.env);

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: env.DATABASE_HOST,
  port: env.DATABASE_PORT,
  username: env.DATABASE_USERNAME,
  password: env.DATABASE_PASSWORD,
  database: env.DATABASE_NAME,
  entities,
  migrations: ['src/migrations/*.ts'],
  logging: env.NODE_ENV === 'development',
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;
