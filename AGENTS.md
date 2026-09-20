# AGENTS.md — St. Andrew Funeral Home Backend Microservice

Guidance for AI agents and human engineers contributing to the **`saint-andrew-backend`** repository.

---

## 1. Repository Scope & Boundaries

This repository is **exclusively a backend Node.js / Express microservice**. It contains **no UI components, HTML client pages, or React code**.

### Core Responsibilities
1. **SMS Gateway Integration**: Semaphore SMS dispatch (`/send-balance-sms`) with simulated fallback in local dev.
2. **Transactional Email**: Brevo SMTP integration (`/send-support-email`, `/send-otp-email`).
3. **Authentication Support**: Cryptographic OTP generation and verification for password reset flows.
4. **Firebase Admin Integration**: Administrative reads and writes to Cloud Firestore and Firebase Auth using the Firebase Admin SDK.

### ⚠️ API Contract Immutability Rule
Both client frontends (`saint-andrew-admin-web` and `saint-andrew-mobile`) depend on the exact endpoints defined in this service. **Never rename existing route paths, alter expected request body keys, or change response structures without explicit user instruction.**

---

## 2. Engineering Conventions & Coding Standards

### 2.1 Layered Architecture Discipline
Maintain strict separation between layers:
- **Routes (`src/routes/`)**: Declare URL paths, HTTP methods, and attach controllers/middleware. No business logic in routes.
- **Controllers (`src/controllers/`)**: Validate request bodies, call services, and return standard HTTP JSON responses.
- **Services (`src/services/`)**: Implement business logic, external API calls (Semaphore, Brevo), and database transactions.
- **Middleware (`src/middleware/`)**: Cross-cutting request processing (CORS, logging, error handling, auth).
- **Templates (`src/templates/`)**: Branded HTML and SMS string builders with Calm Memorial styling.
- **Config (`src/config/`)**: Environment resolution and SDK initialization.

### 2.2 Error Handling & HTTP Status Codes
- Never let an unhandled Promise rejection crash the server. Always pass errors to `next(err)` or wrap with try/catch.
- Return consistent JSON error payloads:
  ```javascript
  return res.status(400).json({ success: false, error: 'Detailed validation message' });
  ```
- Use appropriate HTTP status codes:
  - `200 OK`: Successful retrieval or operation.
  - `400 Bad Request`: Missing or malformed payload fields.
  - `404 Not Found`: Route or entity does not exist.
  - `500 Internal Server Error`: External gateway failure (Semaphore/Brevo) or unexpected crash.

### 2.3 Secrets & Environment Discipline
- Never commit `.env` or `service-account.json`.
- All configurable parameters must have safe fallbacks in [`src/config/env.config.js`](src/config/env.config.js).
- When third-party API keys are not supplied, services must fail gracefully or enter simulation mode rather than throwing startup errors.

---

## 3. Local Development & Testing

```powershell
# Install dependencies
npm install

# Start the server (port 3000)
npm start

# Run endpoint sanity checks
npm test

# Run the security regression suite (auth, authorization, rate limiting, OTP lockout)
# against a running server — start the server on a test port first, e.g.:
#   PORT=3099 npm start
# then in another terminal:
PORT=3099 npm run test:security
```
