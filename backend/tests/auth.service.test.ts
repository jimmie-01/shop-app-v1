import assert from "node:assert/strict";
import { test } from "vitest";
import type { AuthenticatedUser, GoogleIdentity, UserRepository } from "../src/repositories/user.repository.js";
import type { SessionRepository } from "../src/repositories/session.repository.js";
import { AuthService, googleLoginSchema } from "../src/services/auth.service.js";
import type { GoogleTokenVerifier } from "../src/services/google-token.service.js";
import { hashSessionToken, SESSION_TTL_SECONDS } from "../src/services/session.service.js";

const user: AuthenticatedUser = { id: "7", email: "shopper@example.test", name: "Shopper", role: "shopper" };

test("Google login schema requires a strict, bounded ID token", () => {
  assert.deepEqual(googleLoginSchema.parse({ idToken: "verified-token" }), { idToken: "verified-token" });
  for (const input of [null, {}, { idToken: "" }, { idToken: "a".repeat(10_001) }, { idToken: "token", role: "shop_owner" }]) {
    assert.equal(googleLoginSchema.safeParse(input).success, false);
  }
});

test("service verifies Google identity, stores only a token hash, and sets expiry", async () => {
  let verifiedToken = "";
  let created: { hash: string; userId: string; expiresAt: Date } | undefined;
  const now = 1_700_000_000_000;
  const identity: GoogleIdentity = { googleSub: "stable-google-sub", email: user.email, name: user.name };
  const users: UserRepository = {
    async findOrCreateFromGoogle(value) { assert.deepEqual(value, identity); return user; },
    async findById() { return user; },
  };
  const verifier: GoogleTokenVerifier = { async verify(token) { verifiedToken = token; return identity; } };
  const sessions: SessionRepository = {
    async create(hash, userId, expiresAt) { created = { hash, userId, expiresAt }; },
    async findUser() { return user; },
    async revoke() {},
  };
  const service = new AuthService(users, verifier, sessions, () => now);
  const result = await service.login({ idToken: "verified-token" });

  assert.equal(verifiedToken, "verified-token");
  assert.deepEqual(result.user, user);
  assert.equal(result.sessionToken.length, 43);
  assert.deepEqual(created, {
    hash: hashSessionToken(result.sessionToken), userId: user.id,
    expiresAt: new Date(now + SESSION_TTL_SECONDS * 1000),
  });
  assert.notEqual(created?.hash, result.sessionToken);
});

test("service hashes lookup and revocation tokens and tolerates logout without a cookie", async () => {
  const token = "opaque-session-token";
  const lookups: string[] = [];
  const revocations: string[] = [];
  const service = new AuthService(
    { async findOrCreateFromGoogle() { return user; }, async findById() { return user; } },
    { async verify() { return { googleSub: "sub", email: user.email, name: user.name }; } },
    {
      async create() {},
      async findUser(hash) { lookups.push(hash); return user; },
      async revoke(hash) { revocations.push(hash); },
    },
  );
  assert.equal(await service.userFromSession(token), user);
  await service.logout(token);
  await service.logout(null);
  assert.deepEqual(lookups, [hashSessionToken(token)]);
  assert.deepEqual(revocations, [hashSessionToken(token)]);
});
