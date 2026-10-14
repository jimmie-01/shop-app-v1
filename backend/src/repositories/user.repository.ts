import { pool } from "../config/database.js";

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  role: "shopper" | "shop_owner";
};

export type GoogleIdentity = { googleSub: string; email: string; name: string };

export const userRepository = {
  async findOrCreateFromGoogle(identity: GoogleIdentity): Promise<AuthenticatedUser> {
    const result = await pool.query<AuthenticatedUser>(
      `INSERT INTO users (google_sub, email, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (google_sub) DO UPDATE
       SET email = EXCLUDED.email, name = EXCLUDED.name, updated_at = NOW()
       RETURNING id, email, name, role`,
      [identity.googleSub, identity.email, identity.name],
    );
    return result.rows[0];
  },

  async findById(id: string): Promise<AuthenticatedUser | null> {
    const result = await pool.query<AuthenticatedUser>(
      "SELECT id, email, name, role FROM users WHERE id = $1",
      [id],
    );
    return result.rows[0] ?? null;
  },
};

export type UserRepository = typeof userRepository;
