import assert from "node:assert/strict";
import { test, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/config/database.js", () => ({ pool: { query } }));
const { productRepository } = await import("../src/repositories/product.repository.js");

test("product repository reads products and returns null for a missing product", async () => {
  query.mockResolvedValueOnce({ rows: [{ id: "1" }] }).mockResolvedValueOnce({ rows: [] });
  assert.deepEqual(await productRepository.list(), [{ id: "1" }]);
  assert.deepEqual(await productRepository.findById("4"), null);
  assert.match(query.mock.calls[0][0], /ORDER BY id/);
  assert.deepEqual(query.mock.calls[1][1], ["4"]);
  assert.match(query.mock.calls[1][0], /WHERE id = \$1/);
});

test("product repository parameterizes create, update, and delete values", async () => {
  query.mockResolvedValueOnce({ rows: [{ id: "3" }] })
    .mockResolvedValueOnce({ rows: [{ id: "3" }] })
    .mockResolvedValueOnce({ rowCount: 1 });
  const input = { name: "Cup", description: "Stoneware", price: 4.5, image_url: null, stock_quantity: 2 };
  await productRepository.create(input);
  await productRepository.update("3", { name: "New Cup", stock_quantity: 8 });
  assert.equal(await productRepository.delete("3"), true);

  assert.match(query.mock.calls[0][0], /VALUES \(\$1, \$2, \$3, \$4, \$5\)/);
  assert.deepEqual(query.mock.calls[0][1], ["Cup", "Stoneware", 4.5, null, 2]);
  assert.match(query.mock.calls[1][0], /name = \$1, stock_quantity = \$2, updated_at = NOW\(\) WHERE id = \$3/);
  assert.deepEqual(query.mock.calls[1][1], ["New Cup", 8, "3"]);
  assert.deepEqual(query.mock.calls[2][1], ["3"]);
});
