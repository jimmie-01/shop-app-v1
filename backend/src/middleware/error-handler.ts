import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { InvalidGoogleTokenError } from "../services/google-token.service.js";
import { ProductNotFoundError } from "../services/product.service.js";
import { CheckoutProductNotFoundError, InsufficientStockError } from "../repositories/order.repository.js";

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof ZodError) {
    response.status(400).json({ error: "Invalid request", details: error.issues.map(({ path, message }) => ({ path, message })) });
    return;
  }
  if (error instanceof ProductNotFoundError) {
    response.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof CheckoutProductNotFoundError) {
    response.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof InsufficientStockError) {
    response.status(409).json({ error: "Insufficient stock", product_id: error.productId });
    return;
  }
  if (error instanceof InvalidGoogleTokenError) {
    response.status(401).json({ error: "Google authentication failed" });
    return;
  }
  if (error instanceof SyntaxError && "body" in error) {
    response.status(400).json({ error: "Invalid JSON body" });
    return;
  }
  const errorType = error instanceof Error ? error.name : typeof error;
  console.error(`Unhandled request error (${errorType})`);
  response.status(500).json({ error: "Internal server error" });
};
