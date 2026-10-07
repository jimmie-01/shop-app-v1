import { checkDatabaseConnection } from "../repositories/database.repository.js";

export async function checkDatabaseHealth(): Promise<{ status: "ok" }> {
  await checkDatabaseConnection();
  return { status: "ok" };
}
