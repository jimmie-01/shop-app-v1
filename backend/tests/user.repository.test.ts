import assert from "node:assert/strict";
import { test, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/config/database.js", () => ({ pool: { query } }));
const { userRepository } = await import("../src/repositories/user.repository.js");

test("user repository upserts by Google sub and refreshes profile data without accepting role", async () => {
  query.mockResolvedValueOnce({ rows: [{ id: "2", role: "shopper" }] });
  const identity = { googleSub: "google-sub", email: "new@example.test", name: "New Name" };
  await userRepository.findOrCreateFromGoogle(identity);
  assert.match(query.mock.calls[0][0], /ON CONFLICT \(google_sub\) DO UPDATE/);
  assert.match(query.mock.calls[0][0], /email = EXCLUDED\.email, name = EXCLUDED\.name/);
  assert.doesNotMatch(query.mock.calls[0][0], /role\s*=\s*EXCLUDED/);
  assert.deepEqual(query.mock.calls[0][1], [identity.googleSub, identity.email, identity.name]);
  assert.match(query.mock.calls[0][0], /RETURNING id, email, name, role/);
});

test("user repository looks up the application identity by parameterized ID", async () => {
  query.mockResolvedValueOnce({ rows: [] });
  assert.equal(await userRepository.findById("6"), null);
  assert.match(query.mock.calls[0][0], /WHERE id = \$1/);
  assert.deepEqual(query.mock.calls[0][1], ["6"]);
});
