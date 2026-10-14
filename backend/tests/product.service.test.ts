import assert from "node:assert/strict";
import { test } from "node:test";
import type { Product, ProductInput, ProductRepository } from "../src/repositories/product.repository.js";
import { ProductNotFoundError, ProductService, createProductSchema, updateProductSchema } from "../src/services/product.service.js";

function makeRepository(): ProductRepository {
  return {
    async list() { return []; },
  async findById() { return null; },
    async create(input: ProductInput) { return { ...input, id: "1", price: String(input.price), created_at: new Date(), updated_at: new Date() }; },
    async update() { return null; },
    async delete() { return false; },
  };
}

test("product schemas accept valid values and reject invalid values", () => {
  assert.deepEqual(createProductSchema.parse({ name: " Item ", description: "Description", price: 0, stock_quantity: 0 }), {
    name: "Item", description: "Description", price: 0, stock_quantity: 0, image_url: null,
  });
  assert.equal(createProductSchema.safeParse({ name: "", description: "x", price: -1, stock_quantity: -1 }).success, false);
  assert.equal(createProductSchema.safeParse({ name: "x", description: "x", price: "1", stock_quantity: 0 }).success, false);
  assert.equal(createProductSchema.safeParse({ name: "x", description: "x", price: 1, stock_quantity: 0, role: "shop_owner" }).success, false);
  assert.equal(updateProductSchema.safeParse({}).success, false);
  assert.equal(updateProductSchema.safeParse({ stock_quantity: -1 }).success, false);
  assert.equal(updateProductSchema.safeParse({ image_url: "not-a-url" }).success, false);
});

test("service validates IDs and reports missing products", async () => {
  const service = new ProductService(makeRepository());
  await assert.rejects(service.get("0"));
  await assert.rejects(service.get("nope"));
  await assert.rejects(service.get("9223372036854775808"));
  await assert.rejects(service.get("1"), ProductNotFoundError);
  await assert.rejects(service.update(1, { price: -1 }));
  await assert.rejects(service.delete(-1));
});

test("service passes validated create input to the repository", async () => {
  let captured: ProductInput | undefined;
  const repository = makeRepository();
  const service = new ProductService({
    ...repository,
    async create(input) {
      captured = input;
      return { ...input, id: "8", price: String(input.price), created_at: new Date(), updated_at: new Date() } satisfies Product;
    },
  });
  await service.create({ name: "Cup", description: "A cup", price: 4.5, stock_quantity: 3 });
  assert.deepEqual(captured, { name: "Cup", description: "A cup", price: 4.5, stock_quantity: 3, image_url: null });
});
