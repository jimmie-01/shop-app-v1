import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { PoolClient } from "pg";
import { pool } from "./src/config/database.js";

const migrationVersion = "001_initial_schema";
const migrationUrl = new URL("./migrations/001_initial_schema.sql", import.meta.url);
const tables = ["users", "products", "orders", "order_items"];
const advisoryLockId = 731904210;

type TableSignature = {
  columns: unknown[];
  constraints: unknown[];
  indexes: unknown[];
};

async function signatures(client: PoolClient, schema: string): Promise<Record<string, TableSignature>> {
  await client.query(`SET LOCAL search_path TO ${schema}`);
  const result = await client.query(
    `SELECT c.relname AS table_name,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_array(a.attname, format_type(a.atttypid, a.atttypmod),
           a.attnotnull, a.attidentity, pg_get_expr(d.adbin, d.adrelid)) ORDER BY a.attnum)
         FROM pg_attribute a
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       ), '[]'::jsonb) AS columns,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_array(conname, pg_get_constraintdef(oid, true)) ORDER BY conname)
         FROM pg_constraint WHERE conrelid = c.oid
       ), '[]'::jsonb) AS constraints,
       COALESCE((
         SELECT jsonb_agg(replace(pg_get_indexdef(i.indexrelid), quote_ident($2) || '.', '') ORDER BY ci.relname)
         FROM pg_index i JOIN pg_class ci ON ci.oid = i.indexrelid
         WHERE i.indrelid = c.oid AND NOT EXISTS
           (SELECT 1 FROM pg_constraint pc WHERE pc.conindid = i.indexrelid)
       ), '[]'::jsonb) AS indexes
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $2 AND c.relkind = 'r' AND c.relname = ANY($1::text[])
     GROUP BY c.oid, c.relname ORDER BY c.relname`,
    [tables, schema],
  );

  const output: Record<string, TableSignature> = {};
  for (const row of result.rows as Array<{ table_name: string; columns: unknown[]; constraints: unknown[]; indexes: unknown[] }>) {
    output[row.table_name] = { columns: row.columns, constraints: row.constraints, indexes: row.indexes };
  }
  return output;
}

async function verifyExistingSchema(client: PoolClient, migrationSql: string): Promise<void> {
  const expectedSchema = `migration_expected_${randomUUID().replaceAll("-", "")}`;
  await client.query(`CREATE SCHEMA ${expectedSchema}`);
  try {
    await client.query(`SET LOCAL search_path TO ${expectedSchema}`);
    await client.query(migrationSql);
    await client.query("SET LOCAL search_path TO public");
    const expected = await signatures(client, expectedSchema);
    const actual = await signatures(client, "public");
    const discrepancies: string[] = [];
    for (const table of tables) {
      if (!actual[table]) discrepancies.push(`public.${table} is missing`);
      else if (JSON.stringify(actual[table]) !== JSON.stringify(expected[table])) {
        discrepancies.push(`public.${table} differs in columns, types, identity/default properties, constraints, or indexes`);
      }
    }
    if (Object.keys(expected).length !== tables.length) discrepancies.push("migration did not produce the expected four tables");
    if (discrepancies.length) throw new Error(`Schema verification failed: ${discrepancies.join("; ")}`);
  } finally {
    await client.query(`DROP SCHEMA ${expectedSchema} CASCADE`);
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "run" && command !== "baseline" && command !== "verify") {
    throw new Error("Usage: npm run migrate -- run|baseline|verify");
  }
  const migrationSql = await readFile(migrationUrl, "utf8");
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SELECT pg_advisory_xact_lock($1)", [advisoryLockId]);
    if (command === "verify") {
      await verifyExistingSchema(client, migrationSql);
      await client.query("ROLLBACK");
      transactionOpen = false;
      console.log("Existing schema matches the initial migration.");
      return;
    }
    const historyTable = await client.query("SELECT to_regclass('public.schema_migrations') AS table_name");
    if (!historyTable.rows[0].table_name) {
      await client.query(`CREATE TABLE public.schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    }

    const recorded = await client.query("SELECT 1 FROM public.schema_migrations WHERE version = $1", [migrationVersion]);
    if (recorded.rowCount) throw new Error(`${migrationVersion} is already recorded as applied`);

    if (command === "baseline") {
      await verifyExistingSchema(client, migrationSql);
    } else {
      await client.query(migrationSql);
    }
    await client.query("INSERT INTO public.schema_migrations (version) VALUES ($1)", [migrationVersion]);
    await client.query("COMMIT");
    transactionOpen = false;
    console.log(command === "baseline" ? "Initial migration baseline recorded after schema verification." : "Initial migration applied and recorded.");
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    const e = error as { code?: string; name?: string; message?: string };
    console.error("Migration operation failed:", e.message ?? e.code ?? e.name ?? "Error");
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
