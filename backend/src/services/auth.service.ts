import { z } from "zod";
import type { AuthenticatedUser, GoogleIdentity, UserRepository } from "../repositories/user.repository.js";
import type { SessionRepository } from "../repositories/session.repository.js";
import type { GoogleTokenVerifier } from "./google-token.service.js";
import { createSessionToken, hashSessionToken, SESSION_TTL_SECONDS } from "./session.service.js";

export const googleLoginSchema = z.object({ idToken: z.string().min(1).max(10_000) }).strict();

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly googleTokens: GoogleTokenVerifier,
    private readonly sessions: SessionRepository,
    private readonly now: () => number = Date.now,
  ) {}

  async login(idTokenInput: unknown): Promise<{ user: AuthenticatedUser; sessionToken: string }> {
    const { idToken } = googleLoginSchema.parse(idTokenInput);
    const identity: GoogleIdentity = await this.googleTokens.verify(idToken);
    const user = await this.users.findOrCreateFromGoogle(identity);
    const sessionToken = createSessionToken();
    await this.sessions.create(hashSessionToken(sessionToken), user.id, new Date(this.now() + SESSION_TTL_SECONDS * 1000));
    return { user, sessionToken };
  }

  async userFromSession(token: string): Promise<AuthenticatedUser | null> {
    return this.sessions.findUser(hashSessionToken(token));
  }

  async logout(token: string | null): Promise<void> {
    if (token) await this.sessions.revoke(hashSessionToken(token));
  }
}
