import { Router } from "express";
import { getDatabaseHealth } from "../controllers/database-health.controller.js";
import { getHealth } from "../controllers/health.controller.js";

export const healthRouter = Router();

healthRouter.get("/health", getHealth);
healthRouter.get("/health/db", getDatabaseHealth);
