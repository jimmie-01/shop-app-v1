import type { RequestHandler } from "express";
import type { AuthService } from "../services/auth.service.js";
import { readSessionToken } from "../services/session.service.js";
import type { AuthenticatedUser } from "../repositories/user.repository.js";

declare global {
  namespace Express {
    interface Request {
      authenticatedUser?: AuthenticatedUser;
    }
  }
}

export function requireAuthentication(auth: AuthService): RequestHandler {
  return async (request, response, next) => {
    const token = readSessionToken(request.headers.cookie);
    if (!token) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }
    try {
      const user = await auth.userFromSession(token);
      if (!user) {
        response.status(401).json({ error: "Authentication required" });
        return;
      }
      request.authenticatedUser = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireRole(role: AuthenticatedUser["role"]): RequestHandler {
  return (request, response, next) => {
    if (!request.authenticatedUser) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }
    if (request.authenticatedUser.role !== role) {
      response.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
