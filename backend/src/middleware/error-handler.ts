import type { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const errorType = error instanceof Error ? error.name : typeof error;
  console.error(`Unhandled request error (${errorType})`);
  response.status(500).json({ error: "Internal server error" });
};
