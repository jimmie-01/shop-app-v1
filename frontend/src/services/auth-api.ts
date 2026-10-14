export type AppUser = {
  id: string;
  email: string;
  name: string;
  role: "shopper" | "shop_owner";
};

export type ShopProduct = { id: string; name: string; description: string; price: string; image_url: string | null; stock_quantity: number };
export type CartItem = { product_id: string; quantity: number };
export type ShopOrder = { id: string; total_amount: string; status: string; created_at: string; items: Array<{ product_id: string; name: string; quantity: number; unit_price: string }> };
export type ProductInput = { name: string; description: string; price: number; image_url: string | null; stock_quantity: number };

const apiBaseUrl = import.meta.env.VITE_API_URL || "http://localhost:3000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}/api${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || "The request failed.");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const authApi = {
  async currentUser(): Promise<AppUser | null> {
    try {
      const result = await request<{ user: AppUser }>("/auth/me");
      return result.user;
    } catch (error) {
      if (error instanceof Error && error.message === "Authentication required") return null;
      throw error;
    }
  },
  async signIn(idToken: string): Promise<AppUser> {
    const result = await request<{ user: AppUser }>("/auth/google", {
      method: "POST",
      body: JSON.stringify({ idToken }),
    });
    return result.user;
  },
  logout(): Promise<void> {
    return request<void>("/auth/logout", { method: "POST" });
  },
};

export const shopApi = {
  products(): Promise<ShopProduct[]> { return request<ShopProduct[]>("/products"); },
  product(id: string): Promise<ShopProduct> { return request<ShopProduct>(`/products/${id}`); },
  orders(): Promise<ShopOrder[]> { return request<ShopOrder[]>("/orders"); },
  createProduct(product: ProductInput) { return request<ShopProduct>("/products", { method: "POST", body: JSON.stringify(product) }); },
  updateProduct(id: string, product: ProductInput) { return request<ShopProduct>(`/products/${id}`, { method: "PATCH", body: JSON.stringify(product) }); },
  deleteProduct(id: string) { return request<void>(`/products/${id}`, { method: "DELETE" }); },
  checkout(items: CartItem[]) {
    return request<{ id: string; total_amount: string; status: string }>("/checkout", {
      method: "POST", body: JSON.stringify({ items }),
    });
  },
};
