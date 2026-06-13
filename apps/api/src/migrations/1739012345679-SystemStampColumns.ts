import { MigrationInterface, QueryRunner } from 'typeorm';

export class SystemStampColumns1739012345679 implements MigrationInterface {
  name = 'SystemStampColumns1739012345679';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "public"."tenants" ADD COLUMN IF NOT EXISTS created_by uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "public"."tenants" ADD COLUMN IF NOT EXISTS modified_by uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "public"."subscriptions" ADD COLUMN IF NOT EXISTS created_by uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "public"."subscriptions" ADD COLUMN IF NOT EXISTS modified_by uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "public"."tenant_users" ADD COLUMN IF NOT EXISTS created_by uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "public"."tenant_users" ADD COLUMN IF NOT EXISTS modified_by uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "public"."tenants" DROP COLUMN IF EXISTS created_by`,
    );
    await queryRunner.query(
      `ALTER TABLE "public"."tenants" DROP COLUMN IF EXISTS modified_by`,
    );
    await queryRunner.query(
      `ALTER TABLE "public"."subscriptions" DROP COLUMN IF EXISTS created_by`,
    );
    await queryRunner.query(
      `ALTER TABLE "public"."subscriptions" DROP COLUMN IF EXISTS modified_by`,
    );
    await queryRunner.query(
      `ALTER TABLE "public"."tenant_users" DROP COLUMN IF EXISTS created_by`,
    );
    await queryRunner.query(
      `ALTER TABLE "public"."tenant_users" DROP COLUMN IF EXISTS modified_by`,
    );
  }
}
