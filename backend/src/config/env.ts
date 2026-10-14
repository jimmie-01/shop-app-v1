import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  DATABASE_CA_CERT_PATH: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  FRONTEND_ORIGIN: z.string().url(),
  MAILGUN_API_KEY: z.string().optional(),
  MAILGUN_DOMAIN: z.string().optional(),
  ORDER_EMAIL_FROM: z.string().email().optional(),
});

export const env = envSchema.parse(process.env);
