# Shop App - Agent Instructions

## Project Goal

Build a small full-stack shop application.

The application has two user roles:

- shopper
- shop_owner

Shop owners can manage products.

Shoppers can:

- browse products
- view product details
- add products to a cart
- checkout
- view their orders
- log out and sign in again
- retain access to their historical orders

Keep the application simple and production-minded.

Do not introduce unnecessary architecture, dependencies,
services, or abstractions.

---

# Technology Stack

## Frontend

- React
- Vite
- TypeScript
- React Router

## Backend

- Node.js
- Express
- TypeScript
- Zod

## Database

- Supabase PostgreSQL

## File Storage

- Supabase Storage

## Authentication

- Google Identity Services
- Google Cloud OAuth
- Backend-managed authentication/session

## Email

- Mailgun

## Testing

- Vitest
- Supertest

## Development

- Docker
- Git
- GitHub

---

# Architecture

Use a simple layered backend architecture:

Routes
  ↓
Middleware
  ↓
Controllers
  ↓
Services
  ↓
Repositories
  ↓
PostgreSQL

Controllers handle HTTP concerns.

Services contain business logic.

Repositories handle database access.

Do not access the database directly from controllers.

Do not put business logic inside routes.

Do not introduce unnecessary architectural layers.

---

# Database Access

Use PostgreSQL from the backend.

Do not introduce:

- Prisma
- Sequelize
- TypeORM
- Drizzle
- another ORM

unless explicitly requested.

Keep database access simple and explicit.

Use parameterized queries.

Use database transactions where multiple related
operations must succeed or fail together.

---

# Frontend Architecture

Keep the React application simple.

Use:

- components for reusable UI
- pages for route-level screens
- services/api modules for backend requests
- hooks for reusable React logic

Do not introduce Redux or another global state-management
library unless explicitly requested.

React state and context are sufficient for the initial
application.

---

# Authentication

Users authenticate using Google.

The backend must verify Google ID tokens.

Never trust:

- userId from the request body
- email from the request body
- role from the request body

The authenticated user's identity must come from
verified authentication data.

Use Google's `sub` claim as the stable Google identity.

Do not use email as the permanent external identity key.

Authentication credentials must not be stored in localStorage.

Use secure HTTP-only cookies for the application's
authentication/session mechanism.

---

# Authorization

Users have one of two roles:

- shopper
- shop_owner

Shopper permissions:

- browse products
- view product details
- manage cart
- checkout
- view own orders

Shop owner permissions:

- create products
- update products
- delete products
- manage products

Authorization must be enforced by the backend.

Do not rely on hiding frontend buttons for security.

A shopper must never be able to perform shop-owner
operations by manually calling the API.

---

# Users

A user should have at minimum:

- id
- google_id
- email
- name
- role
- created_at
- updated_at

Orders must reference the application's internal
user ID.

---

# Products

A product should contain at minimum:

- id
- name
- description
- price
- image_url
- stock_quantity
- created_at
- updated_at

Product images are stored in Supabase Storage.

Do not store binary image data directly in PostgreSQL.

---

# Cart

The initial cart should be client-side.

Do not create persistent cart database tables unless
explicitly required.

The backend must recalculate product prices during checkout.

Never trust a total supplied by the frontend.

---

# Orders

Use:

- users
- products
- orders
- order_items

An order belongs to exactly one user.

Users can only retrieve their own orders.

Store the product price used at checkout in order_items.

Never calculate historical order totals using the
current product price.

Historical orders must remain correct even if product
prices change later.

---

# Checkout

The frontend sends product IDs and quantities.

The backend must:

1. authenticate the user
2. validate the request
3. retrieve products from PostgreSQL
4. verify product availability
5. calculate the authoritative total
6. create the order
7. create order items
8. commit the database transaction
9. send the confirmation email

The frontend must never determine the authoritative
order total.

---

# Email

Use Mailgun for order confirmation emails.

Mailgun credentials must only exist on the backend.

Never expose Mailgun credentials to React.

A temporary Mailgun failure must not cause an already
successful order to disappear.

The order should remain stored even if email delivery fails.

Email failures should be logged safely.

Never log API keys, passwords, tokens, or secrets.

---

# Database

Use Supabase PostgreSQL.

Database access happens only from the backend.

Never expose the database connection string to the frontend.

Keep database credentials in environment variables.

Use migrations for schema changes.

Never use the production database for automated tests.

---

# Environment Variables

Never commit:

- .env
- database passwords
- Google secrets
- Mailgun API keys
- Supabase service-role keys
- session secrets

Commit an .env.example containing variable names
but no real credentials.

---

# Security

Never trust client-provided:

- user ID
- role
- price
- order total
- ownership information

Validate external input with Zod.

Use parameterized SQL queries.

Use secure HTTP-only cookies for authentication.

Use appropriate CORS configuration.

Do not expose stack traces to clients in production.

Do not log:

- passwords
- tokens
- cookies
- API keys
- database credentials

---

# Error Handling

Use centralized Express error-handling middleware.

Controllers should pass errors to the error handler.

Return appropriate HTTP status codes.

Do not expose internal implementation details
in production responses.

---

# Testing

Meaningful backend features should have tests.

Unit tests should cover:

- services
- business logic
- validation
- authorization logic where appropriate

Integration tests should cover:

- HTTP endpoints
- authentication flows
- authorization boundaries
- database interactions
- order creation
- checkout

Tests must never use the production database.

---

# Development Rules

Before making changes:

1. Inspect the existing code.
2. Understand the current architecture.
3. Identify the smallest change required.
4. Preserve existing conventions.

After making changes:

1. Run relevant tests.
2. Run TypeScript checks.
3. Run linting if configured.
4. Review the git diff.

Do not modify unrelated files.

Do not rewrite working architecture without a
clear requirement.

---

# Dependency Rules

Do not add a dependency when the requirement can
reasonably be implemented with the existing stack.

Before adding a dependency:

1. Explain why it is needed.
2. Check whether an existing dependency solves the problem.
3. Prefer small, well-maintained packages.

Do not introduce:

- Redux
- GraphQL
- microservices
- Redis
- message queues
- Elasticsearch
- Kubernetes
- an ORM
- unnecessary abstraction frameworks

unless explicitly requested.

---

# Scope Control

The initial application should contain only:

1. Product browsing
2. Product management
3. Google authentication
4. Shopping cart
5. Checkout
6. Persistent orders
7. Order history
8. Order confirmation emails

Do not add:

- coupons
- reviews
- ratings
- wishlists
- recommendations
- multi-vendor support
- inventory forecasting
- payment gateways
- analytics dashboards
- subscriptions
- notifications

unless explicitly requested.

---

# Agent Behaviour

Do not assume requirements.

If a requirement is ambiguous and affects architecture,
ask before implementing.

For small changes, implement directly.

For significant changes:

1. Explain the proposed approach.
2. Identify affected files.
3. Implement the smallest maintainable solution.
4. Run tests.
5. Report what changed.

Do not claim that a feature works unless it has
been tested appropriately.

Prefer simple, readable code over clever abstractions.

When modifying the project, follow the existing
architecture instead of introducing a new architecture
for convenience.