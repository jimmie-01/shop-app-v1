import assert from "node:assert/strict";
import request from "supertest";
import { test } from "vitest";
import { createApp } from "../src/app-factory.js";
import type { Product, ProductInput, ProductRepository } from "../src/repositories/product.repository.js";
import type { UserRepository } from "../src/repositories/user.repository.js";
import { createProductRouter } from "../src/routes/product.routes.js";
import { AuthService } from "../src/services/auth.service.js";
import { hashSessionToken } from "../src/services/session.service.js";
import type { SessionRepository } from "../src/repositories/session.repository.js";

const testSessionToken = "test-owner-session-token";
const sessionCookie = `shop_session=${testSessionToken}`;
const frontendOrigin = "http://localhost:5173";

function authService(role: "shopper" | "shop_owner") {
  const user = { id: "7", email: "shopper@example.test", name: "Test User", role };
  const users: UserRepository = {
    async findOrCreateFromGoogle() { return user; },
    async findById(id) { return id === user.id ? user : null; },
  };
  const sessions: SessionRepository = {
    async create() {},
    async findUser(tokenHash) { return tokenHash === hashSessionToken(testSessionToken) ? user : null; },
    async revoke() {},
  };
  return new AuthService(users, { async verify() { return { googleSub: "google-sub", email: user.email, name: user.name }; } }, sessions);
}

function createProductApp(role: "shopper" | "shop_owner" = "shop_owner") {
  const products = new Map<number, Product>();
  let nextId = 1;
  const repository: ProductRepository = {
    async list() { return [...products.values()]; },
    async findById(id) { return products.get(Number(id)) ?? null; },
    async create(input: ProductInput) {
      const now = new Date();
      const product = { ...input, price: String(input.price), id: String(nextId), created_at: now, updated_at: now };
      products.set(nextId++, product);
      return product;
    },
    async update(id, input) {
      const previous = products.get(Number(id));
      if (!previous) return null;
      const updated = { ...previous, ...input, price: input.price === undefined ? previous.price : String(input.price), updated_at: new Date() };
      products.set(Number(id), updated);
      return updated;
    },
    async delete(id) { return products.delete(Number(id)); },
  };
  const app = createApp({ frontendOrigin, productRouter: createProductRouter(repository, authService(role)) });
  return { app, repository };
}

test("product routes expose public reads and support validated owner CRUD", async () => {
  const { app } = createProductApp();
  const api = request(app);
  let response = await api.get("/api/products");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, []);
  assert.equal((await api.get("/api/products/0")).status, 400);
  assert.equal((await api.get("/api/products/not-an-id")).status, 400);
  assert.equal((await api.get("/api/products/1")).status, 404);
  assert.equal((await api.get("/api/products/9223372036854775808")).status, 400);

  const headers = { Origin: frontendOrigin, Cookie: sessionCookie };
  response = await api.post("/api/products").set(headers).send({ name: "Mug", description: "Stoneware", price: 12.5, stock_quantity: 4 });
  assert.equal(response.status, 201);
  assert.equal(response.body.id, "1");
  assert.equal(response.body.image_url, null);
  response = await api.get("/api/products/1");
  assert.equal(response.status, 200);
  assert.equal(response.body.name, "Mug");
  assert.equal((await api.post("/api/products").set(headers).send({ name: "", description: "bad", price: -1, stock_quantity: -2 })).status, 400);
  assert.equal((await api.post("/api/products").set(headers).send({ name: "Mug", description: "x", price: 1, stock_quantity: 1, user_id: 7, role: "shop_owner" })).status, 400);

  response = await api.patch("/api/products/1").set(headers).send({ stock_quantity: 2 });
  assert.equal(response.status, 200);
  assert.equal(response.body.stock_quantity, 2);
  assert.equal((await api.patch("/api/products/999").set(headers).send({ name: "Absent" })).status, 404);
  assert.equal((await api.patch("/api/products/1").set(headers).send({ price: -1 })).status, 400);
  assert.equal((await api.delete("/api/products/1").set(headers)).status, 204);
  assert.equal((await api.get("/api/products/1")).status, 404);
  assert.equal((await api.delete("/api/products/nope").set("Origin", frontendOrigin).set("Cookie", sessionCookie)).status, 400);
});

test("product writes reject unauthenticated users and shoppers, even when the body claims owner role", async () => {
  const { app } = createProductApp("shopper");
  const api = request(app);
  const payload = { name: "Mug", description: "x", price: 1, stock_quantity: 1, role: "shop_owner" };
  assert.equal((await api.post("/api/products").set("Origin", frontendOrigin).send(payload)).status, 401);
  assert.equal((await api.post("/api/products").set("Origin", frontendOrigin).set("Cookie", sessionCookie).send(payload)).status, 403);
});
