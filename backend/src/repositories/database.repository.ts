import { pool } from "../config/database.js";

export async function checkDatabaseConnection(): Promise<void> {
  await pool.query("SELECT 1");
}
