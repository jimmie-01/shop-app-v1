import { Router } from "express";
import { productController } from "../controllers/product.controller.js";
import { requireAuthentication, requireRole } from "../middleware/authentication.js";
import type { ProductRepository } from "../repositories/product.repository.js";
import type { AuthService } from "../services/auth.service.js";
import { ProductService } from "../services/product.service.js";

export function createProductRouter(
  repository: ProductRepository,
  auth: AuthService,
): Router {
  const router = Router();
  const controller = productController(new ProductService(repository));

  router.get("/products", controller.list);
  router.get("/products/:id", controller.get);
  const ownerOnly = [requireAuthentication(auth), requireRole("shop_owner")];
  router.post("/products", ...ownerOnly, controller.create);
  router.patch("/products/:id", ...ownerOnly, controller.update);
  router.delete("/products/:id", ...ownerOnly, controller.delete);
  return router;
}
