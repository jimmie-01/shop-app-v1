import assert from "node:assert/strict";
import { test } from "node:test";
import { CheckoutService, checkoutSchema } from "../src/services/checkout.service.js";
import { CheckoutProductNotFoundError, InsufficientStockError, type CreatedOrder } from "../src/repositories/order.repository.js";

const order: CreatedOrder = { id: "3", total_amount: "12.50", status: "pending", created_at: new Date(), items: [], customer_email: "buyer@example.test" };

test("checkout schema accepts product IDs and quantities only", () => {
  assert.deepEqual(checkoutSchema.parse({ items: [{ product_id: "4", quantity: 2 }] }), { items: [{ product_id: "4", quantity: 2 }] });
  for (const input of [
    { items: [] }, { items: [{ product_id: "1", quantity: 0 }] },
    { items: [{ product_id: "1", quantity: 1.5 }] }, { items: [{ product_id: "0", quantity: 1 }] },
    { items: [{ product_id: "1", quantity: 1, price: 1 }] }, { items: [{ product_id: "1", quantity: 1 }], user_id: "9" },
    { items: [{ product_id: "1", quantity: 1 }, { product_id: "1", quantity: 2 }] },
  ]) assert.equal(checkoutSchema.safeParse(input).success, false);
});

test("service passes only parsed product IDs and quantities to the repository", async () => {
  let captured: unknown;
  const service = new CheckoutService({ async checkout(userId, items) { captured = { userId, items }; return order; } });
  const result = await service.checkout("8", { items: [{ product_id: 2, quantity: 3 }] });
  assert.equal(result.id, order.id);
  assert.equal("customer_email" in result, false);
  assert.deepEqual(captured, { userId: "8", items: [{ product_id: "2", quantity: 3 }] });
  assert.throws(() => service.checkout("8", { items: [{ product_id: "1", quantity: -1 }] }));
});

test("repository errors distinguish deleted products and stock conflicts", () => {
  assert.ok(new CheckoutProductNotFoundError() instanceof Error);
  assert.equal(new InsufficientStockError("4").productId, "4");
});

test("email delivery failure does not fail a committed checkout or expose the recipient", async () => {
  const service = new CheckoutService({ async checkout() { return order; } }, { async send() { throw new Error("mail unavailable"); } });
  const result = await service.checkout("8", { items: [{ product_id: "1", quantity: 1 }] });
  assert.deepEqual(result, { id: "3", total_amount: "12.50", status: "pending", created_at: order.created_at, items: [] });
  assert.equal("customer_email" in result, false);
});
