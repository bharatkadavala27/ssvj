# SSVJ backend

Express 4 + Mongoose 8 on MongoDB Atlas: mobile + OTP login with roles (public / sevak / admin), donations with digital receipts, a Server-Sent Events live feed, and Cloudinary uploads.

```bash
npm install
cp .env.example .env                 # MONGODB_URI, SESSION_SECRET, ADMIN_KEY, CORS_ORIGINS, Cloudinary, SMS
npm run seed                         # reset content to sample data (keeps users and receipt numbers; --force if real donations exist)
npm run create-admin -- 98XXXXXXXX "Name"   # make a number an admin
npm run dev                          # http://localhost:4000/api (restarts on changes)
npm start
```

- `DNS_SERVERS` overrides the resolver for the `mongodb+srv` SRV lookup. Some Windows DNS servers refuse it (`querySrv ECONNREFUSED`).
- `SMS_PROVIDER`: `console` (dev; the code is logged and returned as `devCode`), `fast2sms`, `msg91` or `twilio`.
- Cloudinary uploads are disabled until `CLOUDINARY_API_KEY` is set. Any file type is accepted.

## Auth

`POST /auth/otp {phone}` → `POST /auth/verify {phone, code, name?}` → `{ token, user }`. Then send `Authorization: Bearer <token>`.

- `GET /auth/me` returns the role and assigned villages. Clients must decide the UI from this, never from local state.
- The first login creates a **public** account. Only an admin can set `sevak` / `admin`.
- Tokens carry only the user id; the role is re-read from the database on every request.
- OTP: 6 digits, 5-minute expiry, 5 attempts, 30-second resend gap, 5 per hour per number.
- The server `ADMIN_KEY` (header `x-admin-key`) also acts as admin, for scripts.

## Public API (`/api`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | DB and upload status |
| GET | `/home` | Campaigns + totals, recent donations, top donors, banners, sponsors, events, notifications, villages, gallery, reports, org settings |
| GET | `/donations` | `campaign`, `type=all\|money\|material`, `village`, `q`, `limit`, `before` |
| POST | `/donations` | Pledge `{ campaign, amount \| material, name?, village, anon? }`, linked to the account if logged in |
| GET | `/donations/:id/receipt?t=` | Receipt data for a logged-out donor (token from the pledge response) |
| GET | `/me/donations`, `/me/donations/:id/receipt` | Logged-in donor's own donations (by account or mobile number) |
| GET | `/events`, `/notifications`, `/sponsors`, `/villages`, `/gallery`, `/reports`, `/settings`, `/top-donors` | |
| GET | `/live` | SSE: `donation`, `stats`, `status`, `refresh` |

## Sevak API (`/api/sevak`, role sevak or admin)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/villages` | Assigned villages (with taluka/district for the slip) |
| POST | `/donations` | Cash collected. **403 outside assigned villages.** Status `collected`, receipt number issued |
| GET | `/donations` | The caller's collection history + totals by status |
| GET | `/pending` | App pledges in assigned villages |
| POST | `/donations/:id/collect` | Pledge paid → `collected` + receipt |
| GET | `/receipts/:id` | Receipt data (own receipts; admins all) |

## Admin API (`/api/admin`, role admin)

- CRUD (`GET`, `POST`, `PATCH /:id`, `DELETE /:id`): `campaigns`, `villages`, `sponsors`, `banners`, `gallery`, `reports`, `events`, `notifications`
- `GET/POST /users`, `PATCH /users/:id`: name, phone, role, villages, active. POST upgrades an existing account with that number.
- `GET /donations` (filters: `status`, `campaign`, `village`, `sevak`, `q`, `from`, `to`), `GET /donations/:id`, `POST /donations` (office entry, approved), `PATCH /donations/:id {status, reason}`, `POST /donations/approve {ids}`
- `GET /summary`: totals by status, campaign, village, sevak (incl. amount awaiting approval), last 30 days
- `GET/PATCH /settings`: org name, registration number, logo, header lines, poster contacts, receipt footer, `nextReceiptNo`
- `POST /uploads?kind=<folder>` (multipart, any file) → `{ url, publicId }`; `DELETE /uploads/<publicId>`

## Data notes

- Campaign totals are running counters, seeded with historical figures and updated atomically on record, reject and restore. A village counts the first time anyone from it gives to that campaign.
- Receipt numbers come from an atomic counter (`counters._id = "receipt"`). Set the next number in Settings to continue a paper receipt book.
- The app never processes payments.
