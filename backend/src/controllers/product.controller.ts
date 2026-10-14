import type { RequestHandler } from "express";
import type { ProductService } from "../services/product.service.js";

export function productController(service: ProductService) {
  return {
    list: (async (_request, response) => {
      response.status(200).json(await service.list());
    }) satisfies RequestHandler,
    get: (async (request, response) => {
      response.status(200).json(await service.get(request.params.id));
    }) satisfies RequestHandler,
    create: (async (request, response) => {
      response.status(201).json(await service.create(request.body));
    }) satisfies RequestHandler,
    update: (async (request, response) => {
      response.status(200).json(await service.update(request.params.id, request.body));
    }) satisfies RequestHandler,
    delete: (async (request, response) => {
      await service.delete(request.params.id);
      response.status(204).end();
    }) satisfies RequestHandler,
  };
}
