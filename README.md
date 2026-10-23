# Above Beyond — hotel tokenisation demo

A luxury hotel direct-booking site (Node.js + Express) that takes a guest through search → room → guest & card → confirmation, paying with Adyen Drop-in (Sessions flow). It also captures an OPI trans token for the PMS and, for members who consent, converts the stored card into a member-owned Adyen token with the `/forward` API.

## Run

```bash
npm install
cp .env.example .env   # fill in your Adyen test credentials
npm start              # http://localhost:3000
npm run dev            # same, restarting on server changes (nodemon)
```

## Adyen setup

1. **API credential**: you need an API key and a client key. Add `http://localhost:3000` (and any tunnel URL) to the client key's allowed origins.
2. **Standard webhook**: point it to `https://<public-url>/api/webhook`. For local testing, use a tunnel such as `ngrok http 3000`. Put the HMAC key in `ADYEN_HMAC_KEY`.
3. **Additional data** (Customer Area → Developers → Additional data): turn on the fields that return the recurring and tokenization details, so the AUTHORISATION webhook includes `tokenization.shopperReference` and `tokenization.storedPaymentMethodId`. OPI must also be enabled on the merchant account for `opi.transToken` to come back.
4. **Forward API**: `/forward` has to be enabled on the merchant account by Adyen.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /api/initiateSession` | Creates the reservation (`<room>-<timestamp>-<XXXX>`), creates the member if a guest opts in, stores the save-card consent, and calls `/sessions` with `shopperReference: "not_provided"`, `storePaymentMethod: true` and `additionalData["opi.includeTransToken"]` |
| `GET\|POST /api/redirectUrl` | Return URL, and also the hand-off from the Drop-in's `onPaymentCompleted`. It checks the result with Adyen, then redirects to `/booking/confirmation?status=success\|pending\|refused` |
| `POST /api/webhook` | Handles AUTHORISATION. It updates the payment and reservation status, stores the OPI token, shopper reference and stored payment method ID, and runs `/forward` → `Recurring/v30/storeToken` for members who consented |
| `GET /api/reservations` | Feeds the back office (`/backoffice`) |

Supporting endpoints: `/api/search`, `/api/cart`, `/api/state`, `/api/login`, `/api/logout`, `/api/rooms` and `/api/config`.

## Notes

- **Storage**: reservations and members are kept in server memory (`src/db.js`), so a restart clears them. Each browser's search, cart and login are kept in its `express-session`.
- **Room data**: rooms and rate packages are defined in `data/rooms.json`. The amount charged is (room rate + package surcharge) × nights, in SGD.
- **Demo Settings** (tab on the right edge of every page):
  - **Payment methods:** lists the merchant account's payment methods from Adyen `/paymentMethods`. Unticked types are sent as `blockedPaymentMethods` on `/sessions`.
  - **Member saved cards:** when off, every session uses `shopperReference: "not_provided"` and only the OPI trans token is collected. Changing it deletes every member's saved cards from Adyen, then clears all reservations and members.
  - Settings are held in memory, so they reset when the server restarts.
