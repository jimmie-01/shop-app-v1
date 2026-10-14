import type { CreatedOrder } from "../repositories/order.repository.js";

export class OrderEmailService {
  constructor(private readonly apiKey: string | undefined, private readonly domain: string | undefined, private readonly from: string | undefined) {}

  async send(order: CreatedOrder): Promise<void> {
    if (!this.apiKey || !this.domain || !this.from) return;
    const body = new FormData();
    body.set("from", this.from);
    body.set("to", order.customer_email);
    body.set("subject", `Order #${order.id} confirmation`);
    body.set("text", `Thank you for your order.\n\n${order.items.map((item) => `${item.name} × ${item.quantity} — $${item.unit_price}`).join("\n")}\n\nTotal: $${order.total_amount}`);
    const response = await fetch(`https://api.mailgun.net/v3/${encodeURIComponent(this.domain)}/messages`, {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`api:${this.apiKey}`).toString("base64")}` },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Mailgun rejected the confirmation email");
  }
}
