# CarePath Telemedicine API Reference Guide

**Base URL:** `http://localhost:3000/api/v1`  
**Authentication Scheme:** Bearer Token (JWT in `Authorization: Bearer <token>`)  
**Correlation Tracking:** All requests accept and return `X-Correlation-ID` header  

---

## 1. Authentication Endpoints

### 1.1 Register Patient
- **Endpoint:** `POST /auth/register`
- **Rate Limit:** 120 req / minute
- **Authorization:** Public
- **Request Body:**
  ```json
  {
    "email": "patient@example.test",
    "password": "Password-123456",
    "name": "Rahul Verma",
    "phone": "+91 98765 43210",
    "preferredLanguage": "en",
    "gender": "Male"
  }
  ```
- **Responses:**
  - `201 Created`: Returns `{ user: { id, email, name, role }, accessToken, refreshToken }`
  - `400 Bad Request`: Validation failure (e.g. password < 12 characters)
  - `409 Conflict`: Email already in use

### 1.2 Login
- **Endpoint:** `POST /auth/login`
- **Rate Limit:** 15 req / minute (Brute-force protection)
- **Authorization:** Public
- **Request Body:**
  ```json
  {
    "email": "patient@example.test",
    "password": "Password-123456"
  }
  ```
- **Responses:**
  - `200 OK`: Returns `{ user, accessToken, refreshToken }`
  - `401 Unauthorized`: Invalid credentials or suspended account

### 1.3 Rotate Refresh Token
- **Endpoint:** `POST /auth/refresh`
- **Request Body:** `{ "refreshToken": "<token_string>" }`
- **Responses:**
  - `200 OK`: Returns rotated `{ accessToken, refreshToken }`
  - `401 Unauthorized`: Expired, revoked, or invalid token

### 1.4 Logout
- **Endpoint:** `POST /auth/logout`
- **Request Body:** `{ "refreshToken": "<token_string>" }`
- **Responses:** `204 No Content`

---

## 2. Directory & Availability Endpoints

### 2.1 List Specialties
- **Endpoint:** `GET /specialties`
- **Authorization:** Public
- **Responses:** `200 OK`: `[{ id, name, description, isActive }]`

### 2.2 Search Verified Doctors
- **Endpoint:** `GET /doctors`
- **Query Parameters:**
  - `q`: Search string matching doctor name or bio
  - `specialty`: Specialty name or partial match
  - `mode`: `ONLINE`, `IN_PERSON`, or `ALL`
  - `language`: Spoken language (e.g. `English`, `Hindi`)
  - `page`: Page number (default: 1)
  - `limit`: Items per page (default: 20)
- **Responses:** `200 OK`: `{ data: [...], page, limit, total }`

### 2.3 Get Doctor Profile Details
- **Endpoint:** `GET /doctors/:doctorId`
- **Responses:** `200 OK`: Doctor public profile, qualifications, experience, specialties, fee display

### 2.4 Get Available Future Slots
- **Endpoint:** `GET /doctors/:doctorId/slots`
- **Responses:** `200 OK`: Array of non-blocked, available future slots for verified doctors

---

## 3. Appointments & Scheduling

### 3.1 Book Consultation
- **Endpoint:** `POST /appointments`
- **Authorization:** Required (`PATIENT` role)
- **Required Header:** `Idempotency-Key: <UUID>`
- **Request Body:**
  ```json
  {
    "slotId": "00000000-0000-0000-0000-000000000000",
    "mode": "ONLINE",
    "reasonForVisit": "Chronic digestive imbalance"
  }
  ```
- **Responses:**
  - `201 Created`: `{ data: appointment, replay: false }`
  - `200 OK`: `{ data: appointment, replay: true }` (idempotent replay)
  - `409 Conflict`: Slot unavailable or idempotency conflict

### 3.2 Cancel Appointment
- **Endpoint:** `POST /appointments/:id/cancel`
- **Authorization:** Required (Owning Patient, Assigned Doctor, or Admin)
- **Request Body:** `{ "reason": "Patient conflict" }`
- **Responses:** `200 OK`: `{ data: { id, status: "CANCELLED" } }`

### 3.3 Reschedule Appointment
- **Endpoint:** `POST /appointments/:id/reschedule`
- **Authorization:** Required (Owning Patient or Admin)
- **Request Body:**
  ```json
  {
    "newSlotId": "11111111-1111-1111-1111-111111111111",
    "reason": "Rescheduled due to family commitment"
  }
  ```
- **Responses:**
  - `200 OK`: Returns updated appointment with new slot
  - `409 Conflict`: Selected slot is no longer available

---

## 4. Consultations & Prescriptions

### 4.1 Start Consultation
- **Endpoint:** `POST /consultations/:consultationId/start`
- **Authorization:** Required (`DOCTOR` role, assigned to appointment)
- **Responses:** `200 OK`: Updates status to `IN_PROGRESS` and sets `startedAt`

### 4.2 Complete Consultation
- **Endpoint:** `POST /consultations/:consultationId/complete`
- **Authorization:** Required (`DOCTOR` role, assigned to appointment)
- **Responses:** `200 OK`: Updates status to `COMPLETED` and sets `completedAt`

### 4.3 Save / Amend Clinical Note
- **Endpoint:** `POST /consultations/:consultationId/notes`
- **Authorization:** Required (`DOCTOR` role, assigned to appointment)
- **Request Body:** `{ "content": "Pulse examination: Pitta aggravation..." }`
- **Responses:** `201 Created`: Returns note with version number; archives prior version

### 4.4 Issue Prescription
- **Endpoint:** `POST /consultations/:consultationId/prescriptions`
- **Authorization:** Required (`DOCTOR` role, assigned to appointment)
- **Request Body:**
  ```json
  {
    "items": [
      {
        "name": "Amrutam Agkey Churna",
        "dosage": "1 teaspoon (3g)",
        "frequency": "Twice daily",
        "duration": "21 days",
        "route": "Oral",
        "instructions": "After meals with warm water"
      }
    ]
  }
  ```
- **Responses:** `201 Created`: Returns prescription v1 with items

### 4.5 Amend Prescription
- **Endpoint:** `POST /prescriptions/:prescriptionId/amendments`
- **Authorization:** Required (`DOCTOR` role, assigned to appointment)
- **Request Body:** `{ "reason": "Dosage adjustment", "items": [...] }`
- **Responses:** `201 Created`: Returns prescription v2 and persists amendment audit record

---

## 5. In-App Notifications

### 5.1 List Notifications
- **Endpoint:** `GET /notifications`
- **Query Parameters:** `limit=20`, `unreadOnly=true`
- **Responses:** `200 OK`: `{ data: [...], unreadCount }`

### 5.2 Mark Notification as Read
- **Endpoint:** `PATCH /notifications/:id/read`
- **Responses:** `200 OK`: `{ data: { id, read: true } }`

### 5.3 Mark All as Read
- **Endpoint:** `POST /notifications/mark-all-read`
- **Responses:** `200 OK`: `{ success: true }`

---

## 6. Administration

### 6.1 Analytics Overview
- **Endpoint:** `GET /admin/analytics/overview`
- **Authorization:** `ADMIN` role
- **Responses:** Real database counts of patients, verified doctors, pending verifications, specialties, and appointment status breakdown

### 6.2 Doctor Verification Queue
- **Endpoint:** `GET /admin/verification-queue`
- **Authorization:** `ADMIN` role
- **Responses:** Doctors with `verified: false` and their submitted credentials

### 6.3 Verify Doctor
- **Endpoint:** `POST /doctors/:doctorId/verify`
- **Authorization:** `ADMIN` role
- **Request Body:** `{ "verified": true, "notes": "Approved" }`
- **Responses:** `200 OK`: Doctor marked verified, in-app notification sent

### 6.4 Manage User Status
- **Endpoint:** `PATCH /admin/users/:userId/status`
- **Authorization:** `ADMIN` role
- **Request Body:** `{ "isActive": false, "reason": "Investigation" }`
- **Responses:** `200 OK`: Updates status; revokes active refresh tokens if suspended

### 6.5 System Audit Logs
- **Endpoint:** `GET /admin/audit-logs`
- **Authorization:** `ADMIN` role
- **Query Parameters:** `page=1`, `limit=50`
- **Responses:** Paginated operational audit events
