import { createApp } from "./app-factory.js";
import { env } from "./config/env.js";
import { userRepository } from "./repositories/user.repository.js";
import { productRepository } from "./repositories/product.repository.js";
import { sessionRepository } from "./repositories/session.repository.js";
import { AuthService } from "./services/auth.service.js";
import { GoogleIdTokenVerifier } from "./services/google-token.service.js";
import { createAuthRouter } from "./routes/auth.routes.js";
import { createProductRouter } from "./routes/product.routes.js";
import { createCheckoutRouter } from "./routes/checkout.routes.js";
import { orderRepository } from "./repositories/order.repository.js";
import { CheckoutService } from "./services/checkout.service.js";
import { OrderEmailService } from "./services/order-email.service.js";

const authService = new AuthService(
  userRepository,
  new GoogleIdTokenVerifier(env.GOOGLE_CLIENT_ID),
  sessionRepository,
);

export const app = createApp({
  frontendOrigin: env.FRONTEND_ORIGIN,
  authRouter: createAuthRouter(
    authService,
    env.NODE_ENV === "production",
    env.NODE_ENV === "production" ? "None" : "Lax",
  ),
  productRouter: createProductRouter(productRepository, authService),
  checkoutRouter: createCheckoutRouter(new CheckoutService(
    orderRepository,
    new OrderEmailService(env.MAILGUN_API_KEY, env.MAILGUN_DOMAIN, env.ORDER_EMAIL_FROM),
  ), authService),
});
