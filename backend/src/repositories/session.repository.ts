import { pool } from "../config/database.js";
import type { AuthenticatedUser } from "./user.repository.js";

export const sessionRepository = {
  async create(tokenHash: string, userId: string, expiresAt: Date): Promise<void> {
    await pool.query("DELETE FROM sessions WHERE expires_at <= NOW()");
    await pool.query(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
      [tokenHash, userId, expiresAt],
    );
  },

  async findUser(tokenHash: string): Promise<AuthenticatedUser | null> {
    const result = await pool.query<AuthenticatedUser>(
      `SELECT users.id, users.email, users.name, users.role
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = $1 AND sessions.expires_at > NOW()`,
      [tokenHash],
    );
    return result.rows[0] ?? null;
  },

  async revoke(tokenHash: string): Promise<void> {
    await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  },
};

export type SessionRepository = typeof sessionRepository;
