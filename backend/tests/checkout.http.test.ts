import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app-factory.js";
import { createCheckoutRouter } from "../src/routes/checkout.routes.js";
import { hashSessionToken } from "../src/services/session.service.js";
import { AuthService } from "../src/services/auth.service.js";
import { CheckoutService } from "../src/services/checkout.service.js";

const token = "checkout-test-session";
const user = { id: "19", email: "buyer@example.test", name: "Buyer", role: "shopper" as const };
const auth = new AuthService({ async findOrCreateFromGoogle() { return user; }, async findById(id) { return id === user.id ? user : null; } },
  { async verify() { return { googleSub: "sub", email: user.email, name: user.name }; } },
  { async create() {}, async findUser(hash) { return hash === hashSessionToken(token) ? user : null; }, async revoke() {} });

function setup() {
  let received: unknown;
  const service = new CheckoutService({ async checkout(userId, items) {
    received = { userId, items };
    return { id: "55", total_amount: "9.00", status: "pending", created_at: new Date(), items: [] };
  } });
  const app = createApp({ frontendOrigin: "http://localhost:5173", checkoutRouter: createCheckoutRouter(service, auth) });
  const server = app.listen(0, "127.0.0.1");
  return { server, getReceived: () => received };
}

test("checkout HTTP route requires a session and returns consistent validation errors", async (context) => {
  const { server } = setup();
  context.after(() => server.close()); await once(server, "listening");
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}/api/checkout`;
  const init = (body: unknown, cookie?: string): RequestInit => ({ method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  assert.equal((await fetch(url, init({ items: [{ product_id: "1", quantity: 1 }] }))).status, 401);
  const invalid = await fetch(url, init({ items: [{ product_id: "1", quantity: 0 }] }, `shop_session=${token}`));
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: "Invalid request", details: [{ path: ["items", 0, "quantity"], message: "Number must be greater than 0" }] });
});

test("checkout HTTP route takes order ownership from the authenticated session", async (context) => {
  const { server, getReceived } = setup();
  context.after(() => server.close()); await once(server, "listening");
  const address = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${address.port}/api/checkout`, {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", cookie: `shop_session=${token}` },
    body: JSON.stringify({ items: [{ product_id: "4", quantity: 2 }], user_id: "999", total_amount: "0", role: "shop_owner" }),
  });
  assert.equal(response.status, 400, "the strict schema rejects client ownership and pricing fields");
  const accepted = await fetch(`http://127.0.0.1:${address.port}/api/checkout`, {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", cookie: `shop_session=${token}` },
    body: JSON.stringify({ items: [{ product_id: "4", quantity: 2 }] }),
  });
  assert.equal(accepted.status, 201);
  assert.deepEqual(getReceived(), { userId: "19", items: [{ product_id: "4", quantity: 2 }] });
});
