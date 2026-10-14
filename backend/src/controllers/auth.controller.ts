import type { RequestHandler } from "express";
import type { AuthService } from "../services/auth.service.js";
import { clearSessionCookie, readSessionToken, sessionCookie } from "../services/session.service.js";

export function authController(auth: AuthService, secureCookies: boolean, sameSite: "Lax" | "None") {
  return {
    login: (async (request, response) => {
      const { user, sessionToken } = await auth.login(request.body);
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Set-Cookie", sessionCookie(sessionToken, secureCookies, sameSite));
      response.status(200).json({ user });
    }) satisfies RequestHandler,
    me: ((request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({ user: request.authenticatedUser });
    }) satisfies RequestHandler,
    logout: (async (request, response) => {
      await auth.logout(readSessionToken(request.headers.cookie));
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Set-Cookie", clearSessionCookie(secureCookies, sameSite));
      response.status(204).end();
    }) satisfies RequestHandler,
  };
}
