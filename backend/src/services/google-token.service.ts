import { OAuth2Client, type LoginTicket } from "google-auth-library";
import type { GoogleIdentity } from "../repositories/user.repository.js";

const allowedIssuers = new Set(["accounts.google.com", "https://accounts.google.com"]);

export class InvalidGoogleTokenError extends Error {
  constructor() {
    super("Google ID token is invalid");
    this.name = "InvalidGoogleTokenError";
  }
}

export interface GoogleTokenVerifier {
  verify(idToken: string): Promise<GoogleIdentity>;
}

export class GoogleIdTokenVerifier implements GoogleTokenVerifier {
  constructor(
    private readonly clientId: string,
    private readonly client: Pick<OAuth2Client, "verifyIdToken"> = new OAuth2Client(),
    private readonly now: () => number = Date.now,
  ) {}

  async verify(idToken: string): Promise<GoogleIdentity> {
    try {
      const ticket: LoginTicket = await this.client.verifyIdToken({ idToken, audience: this.clientId });
      const payload = ticket.getPayload();
      if (
        !payload ||
        payload.aud !== this.clientId ||
        !payload.iss ||
        !allowedIssuers.has(payload.iss) ||
        !payload.exp ||
        payload.exp <= Math.floor(this.now() / 1000) ||
        !payload.sub ||
        !payload.email ||
        payload.email_verified !== true ||
        !payload.name
      ) {
        throw new InvalidGoogleTokenError();
      }
      return { googleSub: payload.sub, email: payload.email, name: payload.name };
    } catch {
      throw new InvalidGoogleTokenError();
    }
  }
}
