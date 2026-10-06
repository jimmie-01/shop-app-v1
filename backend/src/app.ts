import express from "express";
import { healthRouter } from "./routes/health.routes.js";
import { errorHandler } from "./middleware/error-handler.js";

export const app = express();

app.disable("x-powered-by");
app.use(express.json());
app.use("/api", healthRouter);
app.use(errorHandler);
