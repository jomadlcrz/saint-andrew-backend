---
name: funeral-system-v2-reference
description: Authoritative technical reference, database schemas, API contracts, design system tokens, and conversion guidelines for St. Andrew Funeral Home React.js (Admin Web) and React Native / Expo (User Mobile) connecting to Firebase and the modular backend microservice.
---

# Funeral System V2 Reference Skill

Use this skill whenever working on, designing, implementing, or debugging any part of the **St. Andrew Funeral Home V2.0** ecosystem:
- **Admin Frontend**: React.js (Vite + TypeScript + Tailwind CSS / shadcn)
- **Customer Mobile Frontend**: React Native (Expo + TypeScript + NativeWind)
- **Shared Infrastructure**: Firebase Project (`funeral-system-7ca06`) + Modular Node/Express Microservice (`saint-andrew-backend/`)

---

## 1. System Philosophy: Infrastructure & Data Contract Integrity

The database schemas, Firestore security rules, Cloud Functions, and REST endpoints remain strictly preserved and compatible across all clients:

1. **Firebase Project**: `funeral-system-7ca06`
   - **Authentication**: Email/Password and phone-based lookup.
   - **Cloud Firestore**: Real-time document database with security rules defined in `firestore.rules`.
   - **Firebase Storage**: Asset and image uploads (`funeral-system-7ca06.firebasestorage.app`).
2. **`saint-andrew-backend/` Microservice**:
   - Deployed on Render (and runnable locally at `http://localhost:3000`).
   - Handles Semaphore SMS notifications (`/send-balance-sms`), Brevo transactional emails (`/send-support-email`, `/send-otp-email`, `/send-reset-link`), and OTP verification (`/verify-otp`).

---

## 2. Firebase Configuration

Both React.js and React Native use these configuration values (sourced from `firebase_options.dart`):

```typescript
export const firebaseConfig = {
  apiKey: "AIzaSyAWfbciuk6Cs7GhF4wJxqSOeU1rqk7ev8U",
  authDomain: "funeral-system-7ca06.firebaseapp.com",
  projectId: "funeral-system-7ca06",
  storageBucket: "funeral-system-7ca06.firebasestorage.app",
  messagingSenderId: "666921949289",
  appId: "1:666921949289:web:22ff5d81eac4c102fc2af8",
  measurementId: "G-S9XY4JVW3E"
};
```

---

## 3. Core Data Contracts (Firestore Collections)

### `users`
- **Path**: `/users/{uid}`
- **Security**: Signed-in user can read/write their own document. Limit-1 query by `phone` allowed for login lookup. Admin can read all.
- **Fields**:
  - `uid`: string
  - `fullName` / `name`: string
  - `email`: string
  - `phone`: string (format: `09XXXXXXXXX` or `+639XXXXXXXXX`)
  - `role`: `'admin' | 'user'`
  - `status`: `'active' | 'inactive' | 'suspended'`
  - `address`: string
  - `createdAt`: Timestamp
  - `updatedAt`: Timestamp

### `transactions`
- **Path**: `/transactions/{transactionId}`
- **Security**: Signed-in users can read/write.
- **Fields**:
  - `userId`: string (ID of the client user; 'walk-in' or admin UID if walk-in)
  - `clientName` / `userName`: string
  - `clientEmail` / `userEmail`: string
  - `clientPhone` / `userPhone`: string
  - `deceasedName`: string
  - `dateOfDeath`: string / Timestamp
  - `packageId` / `serviceType`: string
  - `selectedItems` / `casket`: array or map of items selected
  - `totalPrice` / `totalAmount`: number
  - `amountPaid`: number
  - `balance`: number (`totalPrice - amountPaid`)
  - `paymentStatus`: `'unpaid' | 'partial' | 'paid'`
  - `status`: `'pending' | 'accepted' | 'approved' | 'in_progress' | 'completed' | 'cancelled' | 'rejected'`
  - `proofOfPaymentUrl`: string (Storage download URL)
  - `isWalkIn`: boolean
  - `notes`: string
  - `createdAt`: Timestamp
  - `updatedAt`: Timestamp

### `inventory`
- **Path**: `/inventory/{itemId}`
- **Security**: Signed-in users can read. Only admins (`role == 'admin'`) can write.
- **Fields**:
  - `name`: string
  - `category`: `'caskets' | 'urns' | 'flowers' | 'vehicles' | 'packages' | 'services'`
  - `description`: string
  - `price`: number
  - `stock` / `quantity`: number
  - `available`: boolean
  - `imageUrl`: string
  - `features`: string[]

### `promotions`
- **Path**: `/promotions/{promoId}`
- **Security**: Public read (`allow read: if true`). Admin-only write.
- **Fields**:
  - `title`: string
  - `description`: string
  - `discountType`: `'percentage' | 'fixed'`
  - `discountValue`: number
  - `code`: string
  - `startDate`: Timestamp / string
  - `endDate`: Timestamp / string
  - `isActive`: boolean
  - `imageUrl`: string

### `support_chats` & `messages`
- **Path**: `/support_chats/{chatId}` (where `chatId == userId` for customers)
- **Subcollection**: `/support_chats/{chatId}/messages/{messageId}`
- **Security**: Admin or user where `request.auth.uid == chatId`.
- **Fields (`support_chats`)**:
  - `userId`: string
  - `userName`: string
  - `userEmail`: string
  - `lastMessage`: string
  - `lastMessageTime`: Timestamp
  - `unreadAdminCount`: number
  - `unreadUserCount`: number
- **Fields (`messages`)**:
  - `senderId`: string
  - `senderRole`: `'admin' | 'user'`
  - `text`: string
  - `timestamp`: Timestamp
  - `read`: boolean

### `admin_schedule_tasks`
- **Path**: `/admin_schedule_tasks/{taskId}`
- **Security**: Signed-in users can read/write.
- **Fields**:
  - `title`: string
  - `description`: string
  - `date`: string / Timestamp
  - `startTime`: string
  - `endTime`: string
  - `type`: `'viewing' | 'interment' | 'cremation' | 'consultation' | 'maintenance'`
  - `assignedTo`: string
  - `transactionId`: string (optional)
  - `status`: `'scheduled' | 'in_progress' | 'completed' | 'cancelled'`

### `password_reset`
- **Path**: `/password_reset/{email}`
- **Security**: Public read/write (for OTP verification).
- **Fields**:
  - `otp`: string (6-digit numeric string)
  - `createdAt`: Timestamp (valid for 15 minutes)

---

## 4. REST API Contract (`saint-andrew-backend/`)

Base URL: `http://localhost:3000` (Local) or `https://<render-service-name>.onrender.com` (Production)

### Endpoints
1. `GET /`
   - Health check returning JSON status of Firebase, Semaphore, and Brevo services.
2. `POST /send-balance-sms`
   - **Headers**: `Content-Type: application/json`, `Authorization: Bearer <firebase_id_token>` (Dev bypass in local)
   - **Body**: `{ "phone": "09XXXXXXXXX", "clientName": "...", "deceasedName": "...", "balance": 15000, "dueDate": "..." }`
   - **Response**: `{ "success": true, "messageId": "...", "real": boolean }`
3. `POST /send-support-email`
   - **Headers**: `Content-Type: application/json`
   - **Body**: `{ "name": "...", "email": "...", "subject": "...", "message": "..." }`
   - **Response**: `{ "success": true, "message": "..." }`
4. `POST /send-otp-email`
   - **Body**: `{ "email": "user@example.com" }`
   - **Response**: `{ "success": true, "message": "OTP sent successfully." }`
5. `POST /verify-otp`
   - **Body**: `{ "email": "user@example.com", "otp": "123456" }`
   - **Response**: `{ "success": true, "message": "OTP verified successfully." }`
6. `POST /send-reset-link`
   - **Body**: `{ "email": "user@example.com" }`
   - **Response**: `{ "success": true, "message": "Password reset link sent successfully." }`
7. `GET /test-brevo`
   - Health and account diagnostic check for Brevo transactional email delivery.

---

## 5. Design System Tokens ("Calm Memorial")

Both the React Admin Web and React Native apps must adhere to the canonical "Calm Memorial" palette:

| Token | Hex | Role |
| :--- | :--- | :--- |
| `ink` | `#1F3A5F` | Primary brand navy, main headings, primary CTA buttons |
| `inkSoft` | `#2C4B66` | Secondary navy, subheaders, secondary buttons |
| `inkDeep` | `#152A45` | Darkest navy, admin sidebar background, high-contrast panels |
| `brass` | `#B08D57` | Warm brass accent, borders, active focus rings, badges |
| `brassSoft`| `#D8C3A5` | Soft brass tint, selection backgrounds, chip surfaces |
| `paper` | `#F3EFE8` | Warm off-white app background |
| `linen` | `#FBF9F5` | Clean card and modal surface background |
| `stone` | `#64748B` | Muted secondary / metadata text |
| `outline` | `#E2E0D8` | Hairline card borders and dividers |
| `evergreen`| `#2E6B5E` | Calm success indicator (paid, active, confirmed) |
| `clay` | `#C56A52` | Gentle alert/danger indicator (cancelled, overdue, error) |
| `teal` | `#2FA8A0` | Admin data charts & analytics accent |

### Typography Standard
- **Serif Display**: *Cormorant Garamond* (headings, hero titles, brand logos).
- **Sans-Serif Body**: *Inter* (body text, tables, form inputs, buttons, mobile UI).

---

## 6. Development & Conversion Guidelines

1. **Keep database contracts preserved**: Under NO circumstance modify `firestore.rules` permissions or change collection names.
2. **Real-Time Data**: Replicate Flutter `StreamBuilder` using Firestore modular `onSnapshot(query, callback)`.
3. **Client-Side Inventory Sync**: When updating a transaction status to `'approved'` or `'completed'`, invoke the client sync helper to decrement `inventory/{id}.stock` via a Firestore transaction or batch.
4. **Auth Guards**:
   - In React Admin Web: Check `userDoc.role === 'admin' && userDoc.status === 'active'`. If not, redirect to `/login`.
   - In React Native User App: Allow any authenticated customer whose status is `'active'`.
