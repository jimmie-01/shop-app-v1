import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app-factory.js";
import { createAuthRouter } from "../src/routes/auth.routes.js";
import { createProductRouter } from "../src/routes/product.routes.js";
import type { Product, ProductRepository } from "../src/repositories/product.repository.js";
import type { AuthenticatedUser, GoogleIdentity, UserRepository } from "../src/repositories/user.repository.js";
import { AuthService } from "../src/services/auth.service.js";
import { InvalidGoogleTokenError, type GoogleTokenVerifier } from "../src/services/google-token.service.js";
import { hashSessionToken } from "../src/services/session.service.js";
import type { SessionRepository } from "../src/repositories/session.repository.js";

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
        const existing = usersById.get(existingId)!;
        const updated = { ...existing, email: identity.email, name: identity.name };
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
    async create(input) {
      const now = new Date();
      return { ...input, id: "1", price: String(input.price), created_at: now, updated_at: now };
    },
    async update() { return null; },
    async delete() { return false; },
  };
  const app = createApp({
    frontendOrigin,
    authRouter: createAuthRouter(auth, true, "None"),
    productRouter: createProductRouter(products, auth),
  });
  const server = app.listen(0, "127.0.0.1");
  return { server, usersById, idByGoogleSub, activeSessions };
}

const frontendRequestHeaders = { origin: frontendOrigin };

test("Google login verifies the supplied token, sets a secure session, and exposes only application user fields", async (context) => {
  const { server } = createHarness();
  context.after(() => server.close());
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}/api`;

  let response = await fetch(`${base}/auth/google`, {
    method: "POST", headers: { "content-type": "application/json", ...frontendRequestHeaders }, body: JSON.stringify({ idToken: "invalid-token" }),
  });
  assert.equal(response.status, 401);
  response = await fetch(`${base}/auth/google`, {
    method: "POST", headers: { "content-type": "application/json", ...frontendRequestHeaders },
    body: JSON.stringify({ idToken: "valid-google-id-token", role: "shop_owner", userId: "99" }),
  });
  assert.equal(response.status, 400);

  response = await fetch(`${base}/auth/google`, {
    method: "POST", headers: { "content-type": "application/json", ...frontendRequestHeaders }, body: JSON.stringify({ idToken: "valid-google-id-token" }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const cookie = response.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=None/);
  assert.match(cookie, /Max-Age=604800/);
  assert.match(cookie, /shop_session=[A-Za-z0-9_-]{43}/);
  assert.equal(cookie.split(";")[0].split("=")[1].includes("."), false);
  const result = await response.json() as { user: AuthenticatedUser };
  assert.deepEqual(result.user, { id: "1", email: "verified@example.test", name: "Verified Person", role: "shopper" });
  assert.equal("google_sub" in result.user, false);

  response = await fetch(`${base}/auth/me`, { headers: { cookie: cookie.split(";")[0] } });
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { user: AuthenticatedUser }).user.id, "1");

  response = await fetch(`${base}/auth/logout`, { method: "POST", headers: { ...frontendRequestHeaders, cookie: cookie.split(";")[0] } });
  assert.equal(response.status, 204);
  assert.match(response.headers.get("set-cookie")!, /Max-Age=0/);
  response = await fetch(`${base}/auth/me`);
  assert.equal(response.status, 401);
  response = await fetch(`${base}/auth/me`, { headers: { cookie: cookie.split(";")[0] } });
  assert.equal(response.status, 401, "a copied cookie is invalid as soon as its server-side session is revoked");
});

test("invalid and expired sessions are rejected, and protected product writes require a signed-in owner", async (context) => {
  const { server, usersById, idByGoogleSub, activeSessions } = createHarness();
  context.after(() => server.close());
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}/api`;
  const body = JSON.stringify({ name: "Mug", description: "Stoneware", price: 2, stock_quantity: 3 });
  const postProduct = (cookie?: string, origin = frontendOrigin) => fetch(`${base}/products`, {
    method: "POST", headers: { "content-type": "application/json", origin, ...(cookie ? { cookie } : {}) }, body,
  });

  assert.equal((await fetch(`${base}/auth/me`)).status, 401);
  assert.equal((await fetch(`${base}/auth/me`, { headers: { cookie: "shop_session=malformed.signature" } })).status, 401);
  activeSessions.set(hashSessionToken("expired-session-token"), { userId: "1", expiresAt: new Date(0) });
  assert.equal((await fetch(`${base}/auth/me`, { headers: { cookie: "shop_session=expired-session-token" } })).status, 401);
  assert.equal((await postProduct()).status, 401);

  const loginResponse = await fetch(`${base}/auth/google`, {
    method: "POST", headers: { "content-type": "application/json", ...frontendRequestHeaders }, body: JSON.stringify({ idToken: "valid-google-id-token" }),
  });
  const shopperCookie = loginResponse.headers.get("set-cookie")!.split(";")[0];
  assert.equal((await postProduct(shopperCookie)).status, 403);

  const owner = { id: "3", email: "owner@example.test", name: "Owner", role: "shop_owner" as const };
  usersById.set(owner.id, owner);
  idByGoogleSub.set("preauthorized-owner-sub", owner.id);
  const ownerToken = "owner-session-token";
  activeSessions.set(hashSessionToken(ownerToken), { userId: owner.id, expiresAt: new Date(Date.now() + 60_000) });
  const ownerCookie = `shop_session=${ownerToken}`;
  const created = await postProduct(ownerCookie);
  assert.equal(created.status, 201);
  usersById.set(owner.id, { ...owner, role: "shopper" });
  assert.equal((await postProduct(ownerCookie)).status, 403, "the current role is loaded from the user record on every request");
});

test("CORS permits credentialed frontend requests only from the configured origin", async (context) => {
  const { server } = createHarness();
  context.after(() => server.close());
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}/api/auth/me`;
  const allowed = await fetch(base, { headers: { origin: frontendOrigin } });
  assert.equal(allowed.headers.get("access-control-allow-origin"), frontendOrigin);
  assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");
  const denied = await fetch(base, { headers: { origin: "https://attacker.invalid" } });
  assert.equal(denied.status, 403);
});

test("state-changing requests require the configured Origin, including logout", async (context) => {
  const { server } = createHarness();
  context.after(() => server.close());
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}/api`;
  const body = JSON.stringify({ idToken: "valid-google-id-token" });
  const noOrigin = await fetch(`${base}/auth/google`, { method: "POST", headers: { "content-type": "application/json" }, body });
  assert.equal(noOrigin.status, 403);
  const hostileOrigin = await fetch(`${base}/auth/logout`, { method: "POST", headers: { origin: "https://attacker.invalid" } });
  assert.equal(hostileOrigin.status, 403);
});

test("login does not issue a cookie when the session store fails", async (context) => {
  const { server } = createHarness({ failSessionCreate: true });
  context.after(() => server.close());
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/google`, {
    method: "POST",
    headers: { "content-type": "application/json", ...frontendRequestHeaders },
    body: JSON.stringify({ idToken: "valid-google-id-token" }),
  });
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(await response.json(), { error: "Internal server error" });
});
