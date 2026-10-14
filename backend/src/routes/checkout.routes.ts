import { Router } from "express";
import { checkoutController } from "../controllers/checkout.controller.js";
import { requireAuthentication } from "../middleware/authentication.js";
import type { AuthService } from "../services/auth.service.js";
import type { CheckoutService } from "../services/checkout.service.js";

export function createCheckoutRouter(service: CheckoutService, auth: AuthService): Router {
  const router = Router();
  const controller = checkoutController(service);
  router.get("/orders", requireAuthentication(auth), controller.orders);
  router.post("/checkout", requireAuthentication(auth), controller.checkout);
  return router;
}
