import type { RequestHandler } from "express";
import type { CheckoutService } from "../services/checkout.service.js";

export function checkoutController(service: CheckoutService) {
  return {
    orders: (async (request, response) => {
      response.status(200).json(await service.listForUser(request.authenticatedUser!.id));
    }) satisfies RequestHandler,
    checkout: (async (request, response) => {
      response.status(201).json(await service.checkout(request.authenticatedUser!.id, request.body));
    }) satisfies RequestHandler,
  };
}
