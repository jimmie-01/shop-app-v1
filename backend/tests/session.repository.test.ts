import assert from "node:assert/strict";
import { test, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/config/database.js", () => ({ pool: { query } }));
const { sessionRepository } = await import("../src/repositories/session.repository.js");

test("session repository expires old rows and persists only hashed session tokens", async () => {
  query.mockResolvedValue({ rows: [], rowCount: 1 });
  const expiresAt = new Date("2030-01-01T00:00:00.000Z");
  await sessionRepository.create("hashed-token", "12", expiresAt);
  assert.match(query.mock.calls[0][0], /DELETE FROM sessions WHERE expires_at <= NOW\(\)/);
  assert.match(query.mock.calls[1][0], /INSERT INTO sessions \(token_hash, user_id, expires_at\)/);
  assert.deepEqual(query.mock.calls[1][1], ["hashed-token", "12", expiresAt]);
});

test("session repository resolves active session identity and deletes a revoked token", async () => {
  query.mockResolvedValueOnce({ rows: [{ id: "12", role: "shopper" }] }).mockResolvedValueOnce({ rowCount: 1, rows: [] });
  assert.deepEqual(await sessionRepository.findUser("hashed-token"), { id: "12", role: "shopper" });
  assert.match(query.mock.calls[0][0], /sessions JOIN users ON users\.id = sessions\.user_id/);
  assert.match(query.mock.calls[0][0], /sessions\.expires_at > NOW\(\)/);
  assert.deepEqual(query.mock.calls[0][1], ["hashed-token"]);
  await sessionRepository.revoke("hashed-token");
  assert.match(query.mock.calls[1][0], /DELETE FROM sessions WHERE token_hash = \$1/);
  assert.deepEqual(query.mock.calls[1][1], ["hashed-token"]);
});
