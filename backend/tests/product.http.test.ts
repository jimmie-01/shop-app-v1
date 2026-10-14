import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app-factory.js";
import { createProductRouter } from "../src/routes/product.routes.js";
import type { Product, ProductInput, ProductRepository } from "../src/repositories/product.repository.js";
import type { UserRepository } from "../src/repositories/user.repository.js";
import { AuthService } from "../src/services/auth.service.js";
import { hashSessionToken } from "../src/services/session.service.js";
import type { SessionRepository } from "../src/repositories/session.repository.js";

const testSessionToken = "test-owner-session-token";
const sessionCookie = `shop_session=${testSessionToken}`;

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

function setup() {
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
  const app = createApp({ frontendOrigin: "http://localhost:5173", productRouter: createProductRouter(repository, authService("shop_owner")) });
  const server = app.listen(0, "127.0.0.1");
  return { server, repository };
}

test("product HTTP routes cover public reads, owner CRUD, and invalid requests without a database", async (context) => {
  const { server } = setup();
  context.after(() => server.close());
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}/api/products`;
  const request = (path = "", init?: RequestInit) => fetch(`${base}${path}`, init);
  const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json", cookie: sessionCookie, origin: "http://localhost:5173" }, body: JSON.stringify(body) });

  let response = await request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
  assert.equal((await request("/0")).status, 400);
  assert.equal((await request("/not-an-id")).status, 400);
  assert.equal((await request("/1")).status, 404);
  assert.equal((await request("/9223372036854775808")).status, 400);

  response = await request("", json({ name: "Mug", description: "Stoneware", price: 12.5, stock_quantity: 4 }));
  assert.equal(response.status, 201);
  const created = await response.json() as Product;
  assert.equal(created.id, "1");
  assert.equal(created.image_url, null);
  response = await request("/1");
  assert.equal(response.status, 200);
  assert.equal((await response.json() as Product).name, "Mug");
  assert.equal((await request("", json({ name: "", description: "bad", price: -1, stock_quantity: -2 }))).status, 400);
  assert.equal((await request("", json({ name: "Mug", description: "x", price: 1, stock_quantity: 1, user_id: 7, role: "shop_owner" }))).status, 400);

  response = await request("/1", { method: "PATCH", headers: { "content-type": "application/json", cookie: sessionCookie, origin: "http://localhost:5173" }, body: JSON.stringify({ stock_quantity: 2 }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json() as Product).stock_quantity, 2);
  assert.equal((await request("/999", { method: "PATCH", headers: { "content-type": "application/json", cookie: sessionCookie, origin: "http://localhost:5173" }, body: JSON.stringify({ name: "Absent" }) })).status, 404);
  assert.equal((await request("/1", { method: "PATCH", headers: { "content-type": "application/json", cookie: sessionCookie, origin: "http://localhost:5173" }, body: JSON.stringify({ price: -1 }) })).status, 400);
  assert.equal((await request("/1", { method: "DELETE", headers: { cookie: sessionCookie, origin: "http://localhost:5173" } })).status, 204);
  assert.equal((await request("/1")).status, 404);
  assert.equal((await request("/nope", { method: "DELETE", headers: { cookie: sessionCookie, origin: "http://localhost:5173" } })).status, 400);
  assert.equal((await request("/nope", { method: "DELETE", headers: { cookie: sessionCookie } })).status, 403);
});

test("product writes reject unauthenticated users and shoppers", async (context) => {
  const repository: ProductRepository = {
    async list() { return []; },
    async findById() { return null; },
    async create(input) { throw new Error(String(input)); },
    async update() { return null; },
    async delete() { return false; },
  };
  const server = createApp({ frontendOrigin: "http://localhost:5173", productRouter: createProductRouter(repository, authService("shopper")) }).listen(0, "127.0.0.1");
  context.after(() => server.close());
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  let response = await fetch(`http://127.0.0.1:${address.port}/api/products`, {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173" },
    body: JSON.stringify({ name: "Mug", description: "x", price: 1, stock_quantity: 1, role: "shop_owner" }),
  });
  assert.equal(response.status, 401);
  response = await fetch(`http://127.0.0.1:${address.port}/api/products`, {
    method: "POST", headers: { "content-type": "application/json", cookie: sessionCookie, origin: "http://localhost:5173" },
    body: JSON.stringify({ name: "Mug", description: "x", price: 1, stock_quantity: 1 }),
  });
  assert.equal(response.status, 403);
});
