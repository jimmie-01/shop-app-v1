import assert from "node:assert/strict";
import { test } from "vitest";
import { clearSessionCookie, createSessionToken, hashSessionToken, readSessionToken, sessionCookie, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "../src/services/session.service.js";

test("session tokens are opaque, random, and stored as one-way hashes", () => {
  const first = createSessionToken();
  const second = createSessionToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.match(hashSessionToken(first), /^[a-f0-9]{64}$/);
  assert.notEqual(hashSessionToken(first), first);
  assert.equal(SESSION_TTL_SECONDS, 604800);
});

test("cookie helpers scope the cookie to the app and clear it with matching security flags", () => {
  const cookie = sessionCookie("token", true, "None");
  assert.match(cookie, new RegExp(`^${SESSION_COOKIE_NAME}=token;`));
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=None/);
  assert.match(cookie, /Max-Age=604800/);
  assert.match(cookie, /Secure/);
  assert.match(clearSessionCookie(true, "None"), /Max-Age=0; Secure/);
  assert.doesNotMatch(sessionCookie("token", false, "Lax"), /Secure/);
  assert.match(clearSessionCookie(false, "Lax"), /SameSite=Lax/);
});

test("cookie parsing selects only the named cookie and rejects absent or empty values", () => {
  assert.equal(readSessionToken(undefined), null);
  assert.equal(readSessionToken("other=value"), null);
  assert.equal(readSessionToken("shop_session="), null);
  assert.equal(readSessionToken("other=value; shop_session=token-value; last=x"), "token-value");
});
