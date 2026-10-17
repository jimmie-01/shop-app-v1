import assert from "node:assert/strict";
import request from "supertest";
import { test } from "vitest";
import { createApp } from "../src/app-factory.js";
import { createAuthRouter } from "../src/routes/auth.routes.js";
import { createProductRouter } from "../src/routes/product.routes.js";
import type { ProductRepository } from "../src/repositories/product.repository.js";
import type { AuthenticatedUser, GoogleIdentity, UserRepository } from "../src/repositories/user.repository.js";
import type { SessionRepository } from "../src/repositories/session.repository.js";
import { AuthService } from "../src/services/auth.service.js";
import { InvalidGoogleTokenError, type GoogleTokenVerifier } from "../src/services/google-token.service.js";
import { hashSessionToken } from "../src/services/session.service.js";

const frontendOrigin = "http://localhost:5173";

function createHarness(options: { failSessionCreate?: boolean } = {}) {
  const usersById = new Map<string, AuthenticatedUser>();
  const idByGoogleSub = new Map<string, string>();
  const activeSessions = new Map<string, { userId: string; expiresAt: Date }>();
  let nextUserId = 1;
  const users: UserRepository = {
    async findOrCreateFromGoogle(identity: GoogleIdentity) {
      const existingId = idByGoogleSub.get(identity.googleSub);
      if (existingId) {
        const updated = { ...usersById.get(existingId)!, email: identity.email, name: identity.name };
        usersById.set(existingId, updated);
        return updated;
      }
      const user = { id: String(nextUserId++), email: identity.email, name: identity.name, role: "shopper" as const };
      usersById.set(user.id, user);
      idByGoogleSub.set(identity.googleSub, user.id);
      return user;
    },
    async findById(id) { return usersById.get(id) ?? null; },
  };
  const verifier: GoogleTokenVerifier = {
    async verify(token) {
      if (token !== "valid-google-id-token") throw new InvalidGoogleTokenError();
      return { googleSub: "stable-google-sub", email: "verified@example.test", name: "Verified Person" };
    },
  };
  const sessions: SessionRepository = {
    async create(tokenHash, userId, expiresAt) {
      if (options.failSessionCreate) throw new Error("test session store failure");
      activeSessions.set(tokenHash, { userId, expiresAt });
    },
    async findUser(tokenHash) {
      const session = activeSessions.get(tokenHash);
      return session && session.expiresAt > new Date() ? usersById.get(session.userId) ?? null : null;
    },
    async revoke(tokenHash) { activeSessions.delete(tokenHash); },
  };
  const auth = new AuthService(users, verifier, sessions);
  const products: ProductRepository = {
    async list() { return []; },
    async findById() { return null; },
    async create(input) { return { ...input, id: "1", price: String(input.price), created_at: new Date(), updated_at: new Date() }; },
    async update() { return null; },
    async delete() { return false; },
  };
  const app = createApp({
    frontendOrigin,
    authRouter: createAuthRouter(auth, true, "None"),
    productRouter: createProductRouter(products, auth),
  });
  return { app, usersById, idByGoogleSub, activeSessions };
}

test("Google login verifies identity, issues an HTTP-only cookie, and revokes the server session at logout", async () => {
  const { app } = createHarness();
  const invalid = await request(app).post("/api/auth/google").set("Origin", frontendOrigin).send({ idToken: "invalid-token" });
  assert.equal(invalid.status, 401);
  const extraClaims = await request(app).post("/api/auth/google").set("Origin", frontendOrigin)
    .send({ idToken: "valid-google-id-token", role: "shop_owner", userId: "99" });
  assert.equal(extraClaims.status, 400);

  const login = await request(app).post("/api/auth/google").set("Origin", frontendOrigin).send({ idToken: "valid-google-id-token" });
  assert.equal(login.status, 200);
  assert.equal(login.headers["cache-control"], "no-store");
  const cookieHeader = login.headers["set-cookie"][0] as string;
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /Secure/);
  assert.match(cookieHeader, /SameSite=None/);
  assert.match(cookieHeader, /Max-Age=604800/);
  assert.match(cookieHeader, /shop_session=[A-Za-z0-9_-]{43}/);
  const cookie = cookieHeader.split(";")[0];
  const result = login.body as { user: AuthenticatedUser };
  assert.deepEqual(result.user, { id: "1", email: "verified@example.test", name: "Verified Person", role: "shopper" });
  assert.equal("google_sub" in result.user, false);

  const current = await request(app).get("/api/auth/me").set("Cookie", cookie);
  assert.equal(current.status, 200);
  assert.equal(current.body.user.id, "1");

  const logout = await request(app).post("/api/auth/logout").set("Origin", frontendOrigin).set("Cookie", cookie);
  assert.equal(logout.status, 204);
  assert.match(logout.headers["set-cookie"][0] as string, /Max-Age=0/);
  assert.equal((await request(app).get("/api/auth/me").set("Cookie", cookie)).status, 401,
    "a copied cookie must fail immediately after the server session is revoked");
});

test("authentication rejects missing, malformed, and expired sessions", async () => {
  const { app, activeSessions } = createHarness();
  assert.equal((await request(app).get("/api/auth/me")).status, 401);
  assert.equal((await request(app).get("/api/auth/me").set("Cookie", "shop_session=malformed.signature")).status, 401);
  activeSessions.set(hashSessionToken("expired-session-token"), { userId: "1", expiresAt: new Date(0) });
  assert.equal((await request(app).get("/api/auth/me").set("Cookie", "shop_session=expired-session-token")).status, 401);
});

test("authorization blocks shoppers and rechecks the current role before owner operations", async () => {
  const { app, usersById, idByGoogleSub, activeSessions } = createHarness();
  const payload = { name: "Mug", description: "Stoneware", price: 2, stock_quantity: 3 };
  assert.equal((await request(app).post("/api/products").set("Origin", frontendOrigin).send(payload)).status, 401);

  const login = await request(app).post("/api/auth/google").set("Origin", frontendOrigin).send({ idToken: "valid-google-id-token" });
  const shopperCookie = (login.headers["set-cookie"][0] as string).split(";")[0];
  assert.equal((await request(app).post("/api/products").set("Origin", frontendOrigin).set("Cookie", shopperCookie).send(payload)).status, 403);

  const owner = { id: "3", email: "owner@example.test", name: "Owner", role: "shop_owner" as const };
  usersById.set(owner.id, owner);
  idByGoogleSub.set("preauthorized-owner-sub", owner.id);
  const ownerToken = "owner-session-token";
  activeSessions.set(hashSessionToken(ownerToken), { userId: owner.id, expiresAt: new Date(Date.now() + 60_000) });
  const ownerCookie = `shop_session=${ownerToken}`;
  const created = await request(app).post("/api/products").set("Origin", frontendOrigin).set("Cookie", ownerCookie).send(payload);
  assert.equal(created.status, 201);
  usersById.set(owner.id, { ...owner, role: "shopper" });
  assert.equal((await request(app).post("/api/products").set("Origin", frontendOrigin).set("Cookie", ownerCookie).send(payload)).status, 403);
});

test("credentialed CORS and state-changing requests are restricted to the configured origin", async () => {
  const { app } = createHarness();
  const allowed = await request(app).get("/api/auth/me").set("Origin", frontendOrigin);
  assert.equal(allowed.headers["access-control-allow-origin"], frontendOrigin);
  assert.equal(allowed.headers["access-control-allow-credentials"], "true");
  assert.equal((await request(app).get("/api/auth/me").set("Origin", "https://attacker.invalid")).status, 403);
  assert.equal((await request(app).post("/api/auth/logout")).status, 403);
  assert.equal((await request(app).post("/api/auth/logout").set("Origin", "https://attacker.invalid")).status, 403);
});

test("login does not issue a cookie when session persistence fails", async () => {
  const { app } = createHarness({ failSessionCreate: true });
  const response = await request(app).post("/api/auth/google").set("Origin", frontendOrigin).send({ idToken: "valid-google-id-token" });
  assert.equal(response.status, 500);
  assert.equal(response.headers["set-cookie"], undefined);
  assert.deepEqual(response.body, { error: "Internal server error" });
});
