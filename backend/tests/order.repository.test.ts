import assert from "node:assert/strict";
import { test } from "vitest";
import type { Pool } from "pg";
import { CheckoutProductNotFoundError, InsufficientStockError, OrderRepository } from "../src/repositories/order.repository.js";

type Product = { id: string; name: string; price: string; stock_quantity: number };

function database(initial: Product[], failItemInsert = false) {
  const state = { products: new Map(initial.map((product) => [product.id, { ...product }])), orders: 0, orderItems: 0, committed: 0, rolledBack: 0, lock: Promise.resolve() };
  const pool = {
    async connect() {
      let held: (() => void) | undefined;
      let beforeProducts: Map<string, Product> | undefined;
      let beforeOrders = 0;
      let beforeItems = 0;
      const client = {
        async query(sql: string, values: unknown[] = []) {
          if (sql === "BEGIN") return { rows: [], rowCount: 0 };
          if (sql.includes("FOR UPDATE")) {
            const previous = state.lock;
            let release!: () => void;
            state.lock = new Promise<void>((resolve) => { release = resolve; });
            await previous;
            held = release;
            beforeProducts = new Map([...state.products].map(([id, product]) => [id, { ...product }]));
            beforeOrders = state.orders;
            beforeItems = state.orderItems;
            const ids = values[0] as string[];
            return { rows: ids.flatMap((id) => { const product = state.products.get(id); return product ? [{ ...product }] : []; }), rowCount: ids.length };
          }
          if (sql.startsWith("INSERT INTO orders")) {
            state.orders += 1;
            return { rows: [{ id: String(state.orders), total_amount: values[1], status: "pending", created_at: new Date() }], rowCount: 1 };
          }
          if (sql.startsWith("SELECT email FROM users")) return { rows: [{ email: "buyer@example.test" }], rowCount: 1 };
          if (sql.startsWith("UPDATE products")) {
            const product = state.products.get(String(values[1]));
            if (!product || product.stock_quantity < Number(values[0])) return { rows: [], rowCount: 0 };
            product.stock_quantity -= Number(values[0]); return { rows: [], rowCount: 1 };
          }
          if (sql.startsWith("INSERT INTO order_items")) {
            if (failItemInsert) throw new Error("simulated order item failure");
            state.orderItems += 1; return { rows: [], rowCount: 1 };
          }
          if (sql === "COMMIT") { state.committed += 1; held?.(); held = undefined; return { rows: [], rowCount: 0 }; }
          if (sql === "ROLLBACK") {
            state.rolledBack += 1;
            if (beforeProducts) state.products = beforeProducts;
            state.orders = beforeOrders; state.orderItems = beforeItems;
            held?.(); held = undefined; return { rows: [], rowCount: 0 };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        release() { held?.(); held = undefined; },
      };
      return client;
    },
  } as unknown as Pick<Pool, "connect">;
  return { repository: new OrderRepository(pool), state };
}

test("repository reads locked prices, records snapshot prices, and decrements stock transactionally", async () => {
  const { repository, state } = database([{ id: "2", name: "Cup", price: "6.25", stock_quantity: 4 }]);
  const created = await repository.checkout("17", [{ product_id: "2", quantity: 2 }]);
  assert.equal(created.total_amount, "12.50");
  assert.deepEqual(created.items, [{ product_id: "2", name: "Cup", quantity: 2, unit_price: "6.25" }]);
  assert.equal(state.products.get("2")?.stock_quantity, 2);
  assert.equal(state.committed, 1);
});

test("repository rolls back the order and stock operation when an order item insert fails", async () => {
  const { repository, state } = database([{ id: "1", name: "Cup", price: "2.00", stock_quantity: 2 }], true);
  await assert.rejects(repository.checkout("5", [{ product_id: "1", quantity: 1 }]), /simulated/);
  assert.equal(state.rolledBack, 1);
  assert.equal(state.committed, 0);
  assert.equal(state.products.get("1")?.stock_quantity, 2);
  assert.equal(state.orders, 0);
});

test("repository rejects missing products and insufficient stock", async () => {
  const { repository } = database([{ id: "1", name: "Cup", price: "2.00", stock_quantity: 1 }]);
  await assert.rejects(repository.checkout("5", [{ product_id: "9", quantity: 1 }]), CheckoutProductNotFoundError);
  await assert.rejects(repository.checkout("5", [{ product_id: "1", quantity: 2 }]), InsufficientStockError);
});

test("order history is scoped to its user and restores stored item price snapshots", async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const client = {
    async query(sql: string, values: unknown[] = []) {
      calls.push({ sql, values });
      if (sql.startsWith("SELECT id, total_amount, status, created_at FROM orders")) {
        return { rows: [{ id: "15", total_amount: "8.00", status: "pending", created_at: new Date("2026-01-01") }], rowCount: 1 };
      }
      if (sql.startsWith("SELECT oi.order_id")) {
        return { rows: [{ order_id: "15", product_id: "4", name: "Cup", quantity: 2, unit_price: "4.00" }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() { calls.push({ sql: "RELEASE", values: [] }); },
  };
  const repository = new OrderRepository({ async connect() { return client; } } as unknown as Pick<Pool, "connect">);
  assert.deepEqual(await repository.listForUser("9"), [{
    id: "15", total_amount: "8.00", status: "pending", created_at: new Date("2026-01-01"),
    items: [{ product_id: "4", name: "Cup", quantity: 2, unit_price: "4.00" }],
  }]);
  assert.match(calls[0].sql, /FROM orders WHERE user_id = \$1/);
  assert.deepEqual(calls[0].values, ["9"]);
  assert.match(calls[1].sql, /oi\.unit_price/);
  assert.deepEqual(calls[1].values, [["15"]]);
  assert.equal(calls.at(-1)?.sql, "RELEASE");
});

test("order history returns an empty result without querying items or retaining a client", async () => {
  const calls: string[] = [];
  const client = {
    async query(sql: string) { calls.push(sql); return { rows: [], rowCount: 0 }; },
    release() { calls.push("RELEASE"); },
  };
  const repository = new OrderRepository({ async connect() { return client; } } as unknown as Pick<Pool, "connect">);
  assert.deepEqual(await repository.listForUser("9"), []);
  assert.equal(calls.length, 2);
  assert.equal(calls[1], "RELEASE");
});

test("concurrent checkouts cannot oversell the final unit", async () => {
  const { repository, state } = database([{ id: "1", name: "Cup", price: "2.00", stock_quantity: 1 }]);
  const results = await Promise.allSettled([
    repository.checkout("5", [{ product_id: "1", quantity: 1 }]),
    repository.checkout("6", [{ product_id: "1", quantity: 1 }]),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason instanceof InsufficientStockError).length, 1);
  assert.equal(state.products.get("1")?.stock_quantity, 0);
  assert.equal(state.committed, 1);
});
