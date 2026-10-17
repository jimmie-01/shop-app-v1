import { fileURLToPath } from "node:url";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgres://test:test@127.0.0.1:1/shop_test";
process.env.DATABASE_CA_CERT_PATH = fileURLToPath(new URL("./fixtures/test-ca.crt", import.meta.url));
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.FRONTEND_ORIGIN = "http://localhost:5173";
