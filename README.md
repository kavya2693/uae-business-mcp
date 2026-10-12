# uae-business-mcp

**A local UAE business is invisible to AI assistants.** Ask Claude or ChatGPT "is there a table for four at a halal place in Dubai Marina at 7:30 tonight?" and the best it can do is guess from a stale web page. It can't see today's hours in Dubai time, filter the menu for a nut allergy, check real availability, or leave a booking request the restaurant will actually see.

This repo is a **remote MCP server template** that fixes that for one business at a time. The code stays the same; each business is one `business.json`. The first instance is **Demo Kitchen, Dubai Marina**, a clearly fictional restaurant.

- Streamable HTTP over HTTPS, built on the official MCP TypeScript SDK v2 (`@modelcontextprotocol/server`). Serves both the **2026-07-28** protocol and older **2025-era** clients (the `initialize` handshake).
- Runs on Vercel's free tier. Bookings are stored in Upstash Redis in production, or a local JSON file in development.
- Booking requests are **PENDING** until restaurant staff confirm them in a password-protected `/admin` page. The tools never tell an agent a table is confirmed.

## Tools

| Tool | What an agent uses it for |
|---|---|
| `get_business_info` | Describe the place: cuisine, AED price range, address, phone, amenities, weekly hours, booking rules |
| `get_opening_hours` | "Is it open now?" in **Asia/Dubai** time, when it closes or next opens, today's local date, a day's bookable arrival times |
| `search_menu` | Filter ~15 dishes by text (English or Arabic), dietary tags (`vegetarian`, `vegan`, `halal`, `gluten-free`, `contains-nuts`), excluded tags and max price |
| `check_availability` | Is there a table for N at a date and time? If not, the nearest open slots that day |
| `request_booking` | Create a **PENDING** request and return a reference like `DK-7F3K2Q`. Validates the UAE phone, future date, opening hours, notice period and party size. Rate-limited. |
| `get_booking_status` | Look up a booking by reference **and** phone. A wrong phone number gets the same response as a missing booking. |

Every rejection returns a machine-readable `code` (for example `INVALID_PHONE`, `TOO_SOON`, `SLOT_FULL`, `RATE_LIMITED`), a plain-English `message`, and `alternativeSlots` where they help.

## Run locally

Requires Node 20+. The MCP Inspector itself needs Node 22.19+.

```bash
npm install
cp .env.example .env        # set ADMIN_PASSWORD to enable /admin
npm run dev                 # http://127.0.0.1:3311/mcp
npm test                    # 80 tests: availability, booking, rate limits, admin, privacy
```

| URL | What |
|---|---|
| `http://127.0.0.1:3311/mcp` | MCP endpoint |
| `http://127.0.0.1:3311/admin` | Bookings admin (needs `ADMIN_PASSWORD`) |
| `http://127.0.0.1:3311/privacy` | Privacy policy |
| `http://127.0.0.1:3311/health` | Status and which storage driver is active |

Locally, bookings go to `data/bookings.json` (git-ignored). Use `STORAGE=memory` for a throwaway run.

## Test with MCP Inspector

**Interactive UI:**

```bash
npx @modelcontextprotocol/inspector
```

1. Choose transport **Streamable HTTP** and URL `http://127.0.0.1:3311/mcp`, then **Connect**.
2. Open **Tools → List Tools** and call each one.

**Scripted, every tool plus the failure cases:**

```bash
scripts/inspector-smoke.sh                       # against the local server
scripts/inspector-smoke.sh https://<app>.vercel.app/mcp
```

The script calls all 6 tools through the Inspector CLI. It also checks that a foreign phone, a party that's too large, a past date and a 03:00 booking are rejected. It fills a slot until `SLOT_FULL` and checks that the 6th request from one phone is `RATE_LIMITED`.

## Deploy to Vercel

1. Push this repo to GitHub and import it at vercel.com/new. No build settings are needed: `vercel.json` sends every path to `api/index.ts`.
2. **Add storage before real use.** In the Vercel project go to **Storage → Marketplace → Upstash Redis**; the free tier is fine. Then set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Without them, bookings and rate limits live in one function instance's memory and disappear. `/admin` shows a warning when that's the case.
3. Set `ADMIN_PASSWORD` to a long random string.
4. Deploy, then check `https://<app>.vercel.app/health`. It should report `"storage":"upstash","durable":true`.

Why Vercel works: the 2026-07-28 MCP spec removed protocol sessions, so every request is an independent POST. That maps directly onto stateless serverless functions.

## Add it to Claude as a custom connector

1. In Claude, open **Settings → Connectors → Add custom connector**.
2. Name it (for example "Demo Kitchen") and paste `https://<app>.vercel.app/mcp`.
3. In a new chat, enable the connector and ask: *"Is Demo Kitchen open now? Find me something vegan under 35 AED, then check a table for 2 tomorrow at 19:30."*

The server needs no OAuth. All business information is public, booking requests are rate-limited, and booking lookups need the reference plus the guest's phone number. For ChatGPT, the same URL works as a connector or app. Submitting a ChatGPT app requires a privacy policy URL: use `https://<app>.vercel.app/privacy`.

## Make one for a new business

1. Copy `business.json` and edit it. It's checked against a zod schema at startup (`src/config.ts`), so mistakes fail loudly with the field name.
2. Set `isDemo: false` for a real business. This removes the "fictional" notices from tool results and the privacy page.
3. Give it its own `id` (used as the storage namespace) and `referencePrefix` (`DK` → `DK-XXXXXX`).
4. Deploy as a separate Vercel project, or point one deployment at another file with `BUSINESS_CONFIG=./other-business.json`.
5. Read `/privacy` and make sure it matches how that business actually handles data. It describes what this code does, not legal advice.

Key `bookingRules`:

| Field | Meaning |
|---|---|
| `maxPartySize` | Largest party bookable online; above it, guests are told to call |
| `slotLengthMinutes` | Arrival times run on this grid (e.g. every 30 minutes) |
| `tablesPerSlot` | How many bookings each arrival time can take |
| `minimumNoticeMinutes` | How far ahead a booking must be |
| `maxDaysAhead` | How far into the future bookings open |
| `lastSeatingBeforeCloseMinutes` | Last arrival time before closing |

Opening hours can run past midnight: `{"open": "13:00", "close": "01:00"}`. A 00:30 arrival then appears on the next calendar date.

## Security and privacy notes

- **Origin check.** `/mcp` rejects browser requests from unlisted origins (spec: DNS-rebinding protection). Server-to-server clients send no Origin and pass. Add origins with `ALLOWED_ORIGINS`.
- **Rate limits.** 5 booking requests per phone and 20 per IP, both per 10 minutes. Admin login is limited to 5 attempts per IP per 10 minutes.
- **Admin sessions.**
  - Password compared in constant time.
  - Signed, expiring session cookie (`HttpOnly`, `SameSite=Strict`, `Secure` over HTTPS).
  - Same-origin check on every POST.
  - A strict CSP, and all booking fields HTML-escaped.
- **Capacity.** Upstash checks capacity and creates the booking in one Lua script, so two agents can't take the last table at once.
- **Retention.** Bookings expire 90 days after their date.
- **Deletion.** `/admin` can delete a booking on request.
- **Secrets.** All secrets come from environment variables. `.env` is git-ignored and `.env.example` documents each one.

## Layout

```
business.json            the only file that changes per business
api/index.ts             Vercel entry: every route → src/app.ts
dev.ts                   local Node server around the same handler
src/app.ts               router: /mcp, /admin, /privacy, /health
src/tools.ts             the six MCP tools and their agent-facing descriptions
src/availability.ts      opening hours, slots, notice and capacity (pure)
src/booking.ts           validation, UAE phone rules, references
src/time.ts              Asia/Dubai wall-clock helpers on a UTC server
src/storage/             memory | file | upstash behind one interface
src/ratelimit.ts         memory | upstash
src/admin.ts, privacy.ts the two HTML pages
test/                    vitest suites
scripts/inspector-smoke.sh
```

## Limitations

- Bookings are table counts per arrival time; there's no table-size or seating-duration model. Staff make the final call in `/admin`.
- Nobody is notified of new bookings except through `/admin`. Email or WhatsApp alerts are a natural next step.
- Dietary tags are only as good as `business.json`. The menu tool tells agents to have guests with severe allergies confirm with staff.

## License

MIT
