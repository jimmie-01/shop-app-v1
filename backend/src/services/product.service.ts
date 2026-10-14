import { z } from "zod";
import type { Product, ProductRepository } from "../repositories/product.repository.js";

const productFields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1),
  price: z.number().finite().nonnegative(),
  image_url: z.string().url().nullable().optional(),
  stock_quantity: z.number().int().nonnegative(),
};

const positiveBigintString = z.string().refine(
  (id) => /^[1-9]\d*$/.test(id) && BigInt(id) <= 9223372036854775807n,
);
export const productIdSchema = z.union([
  positiveBigintString,
  z.number().int().positive().safe().transform(String),
]);
export const createProductSchema = z.object({ ...productFields, image_url: productFields.image_url.default(null) }).strict();
export const updateProductSchema = z.object(productFields).partial().strict().refine((input) => Object.keys(input).length > 0, {
  message: "At least one product field must be provided",
});
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export class ProductNotFoundError extends Error {
  constructor() {
    super("Product not found");
    this.name = "ProductNotFoundError";
  }
}

export class ProductService {
  constructor(private readonly repository: ProductRepository) {}

  list(): Promise<Product[]> {
    return this.repository.list();
  }

  async get(id: unknown): Promise<Product> {
    const productId = productIdSchema.parse(id);
    const product = await this.repository.findById(productId);
    if (!product) throw new ProductNotFoundError();
    return product;
  }

  create(input: unknown): Promise<Product> {
    return this.repository.create(createProductSchema.parse(input));
  }

  async update(id: unknown, input: unknown): Promise<Product> {
    const productId = productIdSchema.parse(id);
    const product = await this.repository.update(productId, updateProductSchema.parse(input));
    if (!product) throw new ProductNotFoundError();
    return product;
  }

  async delete(id: unknown): Promise<void> {
    const productId = productIdSchema.parse(id);
    if (!(await this.repository.delete(productId))) throw new ProductNotFoundError();
  }
}
