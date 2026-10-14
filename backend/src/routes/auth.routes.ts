import { Router } from "express";
import { authController } from "../controllers/auth.controller.js";
import { requireAuthentication } from "../middleware/authentication.js";
import type { AuthService } from "../services/auth.service.js";

export function createAuthRouter(auth: AuthService, secureCookies: boolean, sameSite: "Lax" | "None"): Router {
  const router = Router();
  const controller = authController(auth, secureCookies, sameSite);
  router.post("/auth/google", controller.login);
  router.get("/auth/me", requireAuthentication(auth), controller.me);
  router.post("/auth/logout", controller.logout);
  return router;
}
