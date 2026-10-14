import { pool } from "../config/database.js";

export type Product = {
  id: string;
  name: string;
  description: string;
  price: string;
  image_url: string | null;
  stock_quantity: number;
  created_at: Date;
  updated_at: Date;
};

export type ProductInput = Omit<Pick<Product, "name" | "description" | "price" | "image_url" | "stock_quantity">, "price"> & { price: number };
const fields = "id, name, description, price, image_url, stock_quantity, created_at, updated_at";

export const productRepository = {
  async list(): Promise<Product[]> {
    const result = await pool.query<Product>(`SELECT ${fields} FROM products ORDER BY id`);
    return result.rows;
  },

  async findById(id: string): Promise<Product | null> {
    const result = await pool.query<Product>(`SELECT ${fields} FROM products WHERE id = $1`, [id]);
    return result.rows[0] ?? null;
  },

  async create(input: ProductInput): Promise<Product> {
    const result = await pool.query<Product>(
      `INSERT INTO products (name, description, price, image_url, stock_quantity)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${fields}`,
      [input.name, input.description, input.price, input.image_url, input.stock_quantity],
    );
    return result.rows[0];
  },

  async update(id: string, input: Partial<ProductInput>): Promise<Product | null> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const key of ["name", "description", "price", "image_url", "stock_quantity"] as const) {
      if (input[key] !== undefined) {
        values.push(input[key]);
        assignments.push(`${key} = $${values.length}`);
      }
    }
    assignments.push("updated_at = NOW()");
    values.push(id);
    const result = await pool.query<Product>(
      `UPDATE products SET ${assignments.join(", ")} WHERE id = $${values.length} RETURNING ${fields}`,
      values,
    );
    return result.rows[0] ?? null;
  },

  async delete(id: string): Promise<boolean> {
    const result = await pool.query("DELETE FROM products WHERE id = $1", [id]);
    return result.rowCount === 1;
  },
};

export type ProductRepository = typeof productRepository;
