import type { RequestHandler } from "express";

const allowedMethods = "GET, POST, PATCH, DELETE, OPTIONS";
const allowedHeaders = "Content-Type";

export function corsForFrontend(frontendOrigin: string): RequestHandler {
  return (request, response, next) => {
    const origin = request.get("Origin");
    const isStateChanging = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);
    if (origin && origin !== frontendOrigin) {
      response.status(403).json({ error: "Origin is not allowed" });
      return;
    }
    if (isStateChanging && origin !== frontendOrigin) {
      response.status(403).json({ error: "A valid Origin header is required" });
      return;
    }
    response.vary("Origin");
    if (origin === frontendOrigin) {
      response.setHeader("Access-Control-Allow-Origin", frontendOrigin);
      response.setHeader("Access-Control-Allow-Credentials", "true");
      response.setHeader("Access-Control-Allow-Methods", allowedMethods);
      response.setHeader("Access-Control-Allow-Headers", allowedHeaders);
    }
    if (request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }
    next();
  };
}
