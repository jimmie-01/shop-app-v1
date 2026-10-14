import type { RequestHandler } from "express";
import { checkDatabaseHealth } from "../services/database-health.service.js";

export const getDatabaseHealth: RequestHandler = async (_request, response) => {
  const health = await checkDatabaseHealth();
  response.status(200).json(health);
};
