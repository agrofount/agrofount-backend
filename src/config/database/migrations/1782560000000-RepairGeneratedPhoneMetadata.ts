import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class RepairGeneratedPhoneMetadata1782560000000
  implements MigrationInterface
{
  name = 'RepairGeneratedPhoneMetadata1782560000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const schema =
      (queryRunner.connection.options as { schema?: string }).schema ||
      'public';
    const tableName = queryRunner.connection.metadataTableName;
    await queryRunner.createTable(
      new Table({
        name: tableName,
        schema,
        columns: ['type', 'database', 'schema', 'table', 'name', 'value'].map(
          (name) => ({
            name,
            type: 'varchar',
            isNullable: name !== 'type',
          }),
        ),
      }),
      true,
    );
    const escape = (value: string) =>
      queryRunner.connection.driver.escape(value);
    const metadata = `${escape(schema)}.${escape(tableName)}`;
    for (const [table, column] of [
      ['message', 'recipientPhone'],
      ['leads', 'phone'],
    ]) {
      const generated = await queryRunner.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = 'normalizedPhone' AND is_generated = 'ALWAYS'`,
        [schema, table],
      );
      if (!generated.length) continue;
      // Record the expression used by the entity without touching existing data.
      const expression = `CASE WHEN "${column}" IS NULL OR "${column}" = '' THEN NULL ELSE regexp_replace(regexp_replace("${column}", '[^0-9]', '', 'g'), '^0', '234') END`;
      await queryRunner.query(
        `DELETE FROM ${metadata} WHERE "type" = 'GENERATED_COLUMN' AND "schema" = $1 AND "table" = $2 AND "name" = 'normalizedPhone'`,
        [schema, table],
      );
      await queryRunner.query(
        `INSERT INTO ${metadata} ("type", "database", "schema", "table", "name", "value") VALUES ('GENERATED_COLUMN', current_database(), $1, $2, 'normalizedPhone', $3)`,
        [schema, table, expression],
      );
    }
  }

  public async down(): Promise<void> {
    // Keep metadata while its generated columns exist; removing it would break
    // schema inspection again. No application data or columns were changed.
  }
}
