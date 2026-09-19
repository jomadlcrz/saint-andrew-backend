# CLAUDE.md — Backend Microservice

Guidance for Claude Code and AI assistants working in the **`saint-andrew-backend`** repository.

## Commands

```powershell
npm install           # Install Node.js dependencies
npm start             # Start Express server on http://localhost:3000
node test.js          # Run endpoint test suite
# or on Windows: .\start-backend.ps1
```

## Architecture
- **Layered Structure**: `src/routes/` ➔ `src/controllers/` ➔ `src/services/`
- **Integrations**: Semaphore SMS API, Brevo SMTP API, Firebase Admin SDK
- **Templates**: `src/templates/` holds Calm Memorial branded HTML and SMS formatters

## Rules
- Do NOT add frontend/UI dependencies (React, Vite, CSS).
- Preserve all existing REST endpoints: `/`, `/send-balance-sms`, `/send-support-email`, `/send-otp-email`, `/verify-otp`, `/send-password-reset`.
- Never commit `.env` or `service-account.json`.
- All errors must be handled by `src/middleware/error.middleware.js` returning `{ success: false, error: "..." }`.
