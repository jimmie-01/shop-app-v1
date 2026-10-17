import assert from "node:assert/strict";
import request from "supertest";
import { test } from "vitest";
import { createApp } from "../src/app-factory.js";
import { createCheckoutRouter } from "../src/routes/checkout.routes.js";
import { AuthService } from "../src/services/auth.service.js";
import { CheckoutService } from "../src/services/checkout.service.js";
import { hashSessionToken } from "../src/services/session.service.js";

const token = "checkout-test-session";
const user = { id: "19", email: "buyer@example.test", name: "Buyer", role: "shopper" as const };
const auth = new AuthService(
  { async findOrCreateFromGoogle() { return user; }, async findById(id) { return id === user.id ? user : null; } },
  { async verify() { return { googleSub: "sub", email: user.email, name: user.name }; } },
  { async create() {}, async findUser(hash) { return hash === hashSessionToken(token) ? user : null; }, async revoke() {} },
);

function setup() {
  let received: unknown;
  let ordersRequestedFor: string | undefined;
  const service = new CheckoutService({
    async checkout(userId, items) {
      received = { userId, items };
      return { id: "55", total_amount: "9.00", status: "pending", created_at: new Date(), items: [], customer_email: "buyer@example.test" };
    },
    async listForUser(userId) { ordersRequestedFor = userId; return []; },
  });
  const app = createApp({ frontendOrigin: "http://localhost:5173", checkoutRouter: createCheckoutRouter(service, auth) });
  return { app, getReceived: () => received, getOrdersRequestedFor: () => ordersRequestedFor };
}

test("order history requires authentication and is scoped to the session user", async () => {
  const { app, getOrdersRequestedFor } = setup();
  assert.equal((await request(app).get("/api/orders")).status, 401);
  const response = await request(app).get("/api/orders").set("Cookie", `shop_session=${token}`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, []);
  assert.equal(getOrdersRequestedFor(), user.id);
});

test("checkout requires authentication and validates product quantities", async () => {
  const { app } = setup();
  const url = "/api/checkout";
  const unauthenticated = await request(app).post(url).set("Origin", "http://localhost:5173").send({ items: [{ product_id: "1", quantity: 1 }] });
  assert.equal(unauthenticated.status, 401);
  const invalid = await request(app).post(url).set("Origin", "http://localhost:5173").set("Cookie", `shop_session=${token}`).send({ items: [{ product_id: "1", quantity: 0 }] });
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.body, { error: "Invalid request", details: [{ path: ["items", 0, "quantity"], message: "Number must be greater than 0" }] });
});

test("checkout uses session identity and rejects client supplied ownership or totals", async () => {
  const { app, getReceived } = setup();
  const url = "/api/checkout";
  const forged = await request(app).post(url).set("Origin", "http://localhost:5173").set("Cookie", `shop_session=${token}`)
    .send({ items: [{ product_id: "4", quantity: 2 }], user_id: "999", total_amount: "0", role: "shop_owner" });
  assert.equal(forged.status, 400);
  const accepted = await request(app).post(url).set("Origin", "http://localhost:5173").set("Cookie", `shop_session=${token}`)
    .send({ items: [{ product_id: "4", quantity: 2 }] });
  assert.equal(accepted.status, 201);
  assert.deepEqual(getReceived(), { userId: "19", items: [{ product_id: "4", quantity: 2 }] });
});
