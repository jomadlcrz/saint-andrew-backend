# St. Andrew Funeral Home - Backend Microservice

Enterprise-grade, modular Node.js / Express microservice handling transactional communications, SMS dispatches, email delivery, and OTP authentication workflows for **St. Andrew Funeral Home V2.0**.

---

## 🏛️ Architecture Overview

The backend is structured according to **Clean Layered Architecture**, separating transport (routes), business logic (controllers), external integrations (services), presentation (templates), and infrastructure (config/middleware).

```text
saint-andrew-backend/
├── src/
│   ├── config/               # Configuration & SDK initialization
│   │   ├── env.config.js     # Validated environment variables with defaults
│   │   └── firebase.config.js# Firebase Admin SDK & Firestore database connector
│   ├── controllers/          # Request handling, input validation, HTTP responses
│   │   ├── auth.controller.js# OTP dispatch, verification & password reset links
│   │   ├── email.controller.js# Customer support form intake & routing
│   │   ├── health.controller.js# Diagnostics, health check & Brevo status
│   │   └── sms.controller.js # Balance reminder SMS dispatch & Firestore audit
│   ├── middleware/           # Cross-cutting concerns & request pipeline
│   │   ├── auth.middleware.js# Firebase ID Token verification & dev bypass
│   │   ├── cors.middleware.js# Dynamic origin resolution (Vite, Expo, Postman)
│   │   ├── error.middleware.js# Centralized error handler & 404 router
│   │   └── logger.middleware.js# Clean structured HTTP request logging
│   ├── routes/               # Express endpoint definitions
│   │   ├── auth.routes.js    # Auth & recovery routes
│   │   ├── email.routes.js   # Support email routes
│   │   ├── health.routes.js  # Diagnostic routes
│   │   ├── sms.routes.js     # SMS notification routes
│   │   └── index.js          # Master route aggregator
│   ├── services/             # Third-party integrations & domain services
│   │   ├── brevo.service.js  # Brevo (Sendinblue) transactional email API
│   │   ├── otp.service.js    # Cryptographic OTP generation & Firestore storage
│   │   └── semaphore.service.js# Semaphore Philippine SMS Gateway (+ simulation)
│   ├── templates/            # Presentation templates
│   │   ├── email.templates.js# Calm Memorial themed responsive HTML emails
│   │   └── sms.templates.js  # Respectful balance reminder text formatters
│   ├── utils/                # Utility helpers
│   │   ├── phone.util.js     # PH phone normalization (09XXXXXXXXX) & validation
│   │   └── sanitize.util.js  # HTML escaping and string sanitization
│   ├── app.js                # Express app setup, middleware, and route mounting
│   └── server.js             # HTTP server bootstrap & graceful shutdown hooks
├── .env.example              # Configuration template
├── package.json              # Dependency manifest
└── README.md                 # Technical documentation
```

---

## 📡 API Endpoints Contract

### 1. Health & Diagnostics
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/` | System health check, active mode, and service connectivity | No |
| `GET` | `/test-brevo` | Live diagnostic check against Brevo Account API | No |

#### `GET /` Response Example
```json
{
  "status": "online",
  "service": "Saint Andrew Funeral Home Backend Microservice",
  "version": "2.0.0",
  "mode": "production",
  "services": {
    "firebase": "connected",
    "semaphoreSms": "simulated",
    "brevoEmail": "configured"
  },
  "timestamp": "2026-09-19T15:55:07.214Z"
}
```

---

### 2. SMS Notifications
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/send-balance-sms` | Dispatches balance reminder SMS to bereaved family | Bearer Token (Dev bypass in local) |

#### `POST /send-balance-sms` Payload
```json
{
  "phone": "09171234567",
  "clientName": "Maria Santos",
  "deceasedName": "Juan Santos",
  "balance": 15000,
  "dueDate": "Sept 25, 2026",
  "transactionId": "tx_abc123"
}
```

#### Response
```json
{
  "success": true,
  "messageId": "sem_987654321",
  "mode": "production",
  "real": true
}
```
*Note: If `SEMAPHORE_API_KEY` is not present, SMS is automatically simulated without throwing an error.*

---

### 3. Support Inquiries
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/send-support-email` | Receives client contact inquiries and delivers via Brevo | No |

#### `POST /send-support-email` Payload
```json
{
  "name": "Juan Dela Cruz",
  "email": "juan@example.com",
  "subject": "Arrangement Inquiry",
  "message": "Good day, I would like to inquire about viewing chapel schedules."
}
```

---

### 4. Authentication & Password Recovery
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/send-otp-email` | Generates 6-digit OTP, stores in Firestore, sends via Brevo | No |
| `POST` | `/verify-otp` | Verifies OTP code within 15-minute validity window | No |
| `POST` | `/send-reset-link` | Generates official Firebase password reset link and emails it | No |

#### `POST /send-otp-email` Payload
```json
{
  "email": "customer@example.com"
}
```

#### `POST /verify-otp` Payload
```json
{
  "email": "customer@example.com",
  "otp": "492815"
}
```

---

## 🎨 Calm Memorial Design System in Emails

All HTML transactional templates follow the canonical **Calm Memorial** visual identity:
- **Navy ink (`#1F3A5F`)**: Primary header & button styling.
- **Warm Brass (`#B08D57`)**: Accent highlights, OTP verification box borders.
- **Soft Linen (`#FBF9F5`)**: Inner card backgrounds.
- **Warm Paper (`#F3EFE8`)**: Email container background.
- **Slate Stone (`#64748B`)**: Secondary descriptive copy.

---

## 🚀 Running the Backend

### Local Development
```powershell
npm install
npm start
# or on Windows: .\start-backend.ps1
```

### Environment Variables
Configure `.env` in this directory:
```env
PORT=3000
SEMAPHORE_API_KEY=your_semaphore_key
BREVO_API_KEY=your_brevo_api_key
BREVO_SENDER_EMAIL=saintandrewfh@gmail.com
FIREBASE_SERVICE_ACCOUNT_JSON=...
```

*If `FIREBASE_SERVICE_ACCOUNT_JSON` is not provided in `.env`, the backend automatically looks for local `service-account.json` or runs in development simulation mode.*

---

## 📚 Documentation Reference
- [System Architecture](ARCHITECTURE.md)
- [Coding Guidelines for AI Agents](AGENTS.md)
- [Quick CLI Commands](CLAUDE.md)
- [Data Dictionary & API Schemas](docs/funeral-system-complete-reference.md)
- [Production Deployment Guide](docs/DEPLOYMENT_GUIDE.md)

