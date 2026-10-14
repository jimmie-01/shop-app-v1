import express, { type Router } from "express";
import { corsForFrontend } from "./middleware/cors.js";
import { errorHandler } from "./middleware/error-handler.js";
import { healthRouter } from "./routes/health.routes.js";

export function createApp(options: { frontendOrigin: string; authRouter?: Router; productRouter?: Router; checkoutRouter?: Router }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(corsForFrontend(options.frontendOrigin));
  app.use(express.json());
  app.use("/api", healthRouter);
  if (options.authRouter) app.use("/api", options.authRouter);
  if (options.productRouter) app.use("/api", options.productRouter);
  if (options.checkoutRouter) app.use("/api", options.checkoutRouter);
  app.use(errorHandler);
  return app;
}
