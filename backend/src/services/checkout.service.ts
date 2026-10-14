import { z } from "zod";
import type { OrderRepository } from "../repositories/order.repository.js";
import type { OrderEmailService } from "./order-email.service.js";

const productId = z.union([
  z.string().regex(/^[1-9]\d*$/).refine((id) => BigInt(id) <= 9223372036854775807n),
  z.number().int().positive().safe().transform(String),
]);
export const checkoutSchema = z.object({
  items: z.array(z.object({ product_id: productId, quantity: z.number().int().positive().max(2147483647) }).strict()).min(1).max(100)
    .refine((items) => new Set(items.map(({ product_id }) => product_id)).size === items.length, "Each product may appear only once"),
}).strict();

export class CheckoutService {
  constructor(private readonly orders: Pick<OrderRepository, "checkout" | "listForUser">, private readonly email?: Pick<OrderEmailService, "send">) {}

  listForUser(userId: string) { return this.orders.listForUser(userId); }

  checkout(userId: string, input: unknown) {
    const { items } = checkoutSchema.parse(input);
    return this.orders.checkout(userId, items).then(async (order) => {
      try { await this.email?.send(order); }
      catch (error) { console.error(`Order confirmation email failed (${error instanceof Error ? error.name : "Error"})`); }
      const { customer_email: _customerEmail, ...response } = order;
      return response;
    });
  }
}
