import assert from "node:assert/strict";
import { test } from "node:test";
import type { LoginTicket, OAuth2Client } from "google-auth-library";
import { GoogleIdTokenVerifier, InvalidGoogleTokenError } from "../src/services/google-token.service.js";

const now = 1_800_000_000_000;
const validPayload = {
  aud: "web-client-id",
  iss: "https://accounts.google.com",
  exp: Math.floor(now / 1000) + 60,
  sub: "stable-google-sub",
  email: "person@example.test",
  email_verified: true,
  name: "Verified Person",
};

function verifierWithPayload(payload: typeof validPayload | null, shouldReject = false) {
  let audience: string | string[] | undefined;
  const client = {
    async verifyIdToken(options: { idToken: string; audience?: string | string[] }) {
      audience = options.audience;
      if (shouldReject) throw new Error("mock signature verification failure");
      return { getPayload: () => payload } as unknown as LoginTicket;
    },
  } as unknown as Pick<OAuth2Client, "verifyIdToken">;
  return { verifier: new GoogleIdTokenVerifier("web-client-id", client, () => now), getAudience: () => audience };
}

test("Google verifier pins the client audience and extracts verified identity claims", async () => {
  const { verifier, getAudience } = verifierWithPayload(validPayload);
  assert.deepEqual(await verifier.verify("mock-id-token"), {
    googleSub: "stable-google-sub", email: "person@example.test", name: "Verified Person",
  });
  assert.equal(getAudience(), "web-client-id");
});

test("Google verifier rejects signature failures and invalid issuer, audience, expiry, or email verification", async () => {
  const cases = [
    { payload: validPayload, shouldReject: true },
    { payload: { ...validPayload, iss: "https://attacker.invalid" } },
    { payload: { ...validPayload, aud: "another-client-id" } },
    { payload: { ...validPayload, exp: Math.floor(now / 1000) - 1 } },
    { payload: { ...validPayload, email_verified: false } },
  ];
  for (const scenario of cases) {
    const { verifier } = verifierWithPayload(scenario.payload, scenario.shouldReject);
    await assert.rejects(verifier.verify("mock-id-token"), InvalidGoogleTokenError);
  }
});
