import type { Pool } from "pg";
import { pool } from "../config/database.js";

export type CheckoutItemInput = { product_id: string; quantity: number };
export type OrderItem = { product_id: string; name: string; quantity: number; unit_price: string };
export type CreatedOrder = { id: string; total_amount: string; status: string; created_at: Date; items: OrderItem[]; customer_email: string };
export type UserOrder = { id: string; total_amount: string; status: string; created_at: Date; items: Array<OrderItem & { name: string }> };

export class CheckoutProductNotFoundError extends Error {
  constructor() { super("One or more products are no longer available"); this.name = "CheckoutProductNotFoundError"; }
}
export class InsufficientStockError extends Error {
  constructor(public readonly productId: string) { super(`Insufficient stock for product ${productId}`); this.name = "InsufficientStockError"; }
}

function priceInCents(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error("Invalid product price in database");
  const amount = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(amount)) throw new Error("Product price exceeds supported order total");
  return amount;
}

function asMoney(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("Order total exceeds supported amount");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export class OrderRepository {
  constructor(private readonly database: Pick<Pool, "connect">) {}

  async listForUser(userId: string): Promise<UserOrder[]> {
    const result = await this.database.connect();
    try {
      const orders = await result.query<{ id: string; total_amount: string; status: string; created_at: Date }>(
        "SELECT id, total_amount, status, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC, id DESC", [userId],
      );
      if (orders.rows.length === 0) return [];
      const items = await result.query<{ order_id: string; product_id: string; name: string; quantity: number; unit_price: string }>(
        "SELECT oi.order_id, oi.product_id, p.name, oi.quantity, oi.unit_price FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ANY($1::bigint[]) ORDER BY oi.id",
        [orders.rows.map((order) => order.id)],
      );
      const byOrder = new Map<string, UserOrder["items"]>();
      for (const item of items.rows) {
        const { order_id, ...orderItem } = item;
        byOrder.set(order_id, [...(byOrder.get(order_id) ?? []), orderItem]);
      }
      return orders.rows.map((order) => ({ ...order, items: byOrder.get(order.id) ?? [] }));
    } finally { result.release(); }
  }

  async checkout(userId: string, items: CheckoutItemInput[]): Promise<CreatedOrder> {
    const client = await this.database.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      const ids = items.map((item) => item.product_id).sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
      const locked = await client.query<{ id: string; name: string; price: string; stock_quantity: number }>(
        "SELECT id, name, price, stock_quantity FROM products WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE",
        [ids],
      );
      const products = new Map(locked.rows.map((product) => [product.id, product]));
      if (products.size !== items.length) throw new CheckoutProductNotFoundError();

      let totalCents = 0;
      const orderItems: OrderItem[] = items.map((item) => {
        const product = products.get(item.product_id);
        if (!product) throw new CheckoutProductNotFoundError();
        if (product.stock_quantity < item.quantity) throw new InsufficientStockError(item.product_id);
        const unitCents = priceInCents(product.price);
        totalCents += unitCents * item.quantity;
        return { product_id: item.product_id, name: product.name, quantity: item.quantity, unit_price: asMoney(unitCents) };
      });
      const total = asMoney(totalCents);
      const customer = await client.query<{ email: string }>("SELECT email FROM users WHERE id = $1", [userId]);
      const order = await client.query<{ id: string; total_amount: string; status: string; created_at: Date }>(
        "INSERT INTO orders (user_id, total_amount) VALUES ($1, $2) RETURNING id, total_amount, status, created_at",
        [userId, total],
      );
      const created = order.rows[0];
      for (const item of orderItems) {
        const updated = await client.query(
          "UPDATE products SET stock_quantity = stock_quantity - $1, updated_at = NOW() WHERE id = $2 AND stock_quantity >= $1",
          [item.quantity, item.product_id],
        );
        if (updated.rowCount !== 1) throw new InsufficientStockError(item.product_id);
        await client.query(
          "INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)",
          [created.id, item.product_id, item.quantity, item.unit_price],
        );
      }
      await client.query("COMMIT");
      transactionOpen = false;
      return { ...created, items: orderItems, customer_email: customer.rows[0].email };
    } catch (error) {
      if (transactionOpen) await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export const orderRepository = new OrderRepository(pool);
