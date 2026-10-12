// The six MCP tools. Descriptions are written for the AI agent that calls them, not for humans.

import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { DIETARY_TAGS, type Business } from './config.js';
import { checkAvailability, openStatus, slotsOnDate } from './availability.js';
import { getBookingStatus, requestBooking } from './booking.js';
import type { RateLimiter } from './ratelimit.js';
import type { BookingStore } from './storage/types.js';
import { WEEKDAYS } from './config.js';

export interface ToolDeps {
  business: Business;
  store: BookingStore;
  rateLimiter: RateLimiter;
  /** Identifies the caller for rate limiting (client IP). */
  clientKey: (req: Request | undefined) => string;
  now?: () => Date;
}

const VERSION = '0.1.0';

function result(data: Record<string, unknown>, isError = false) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }], structuredContent: data, isError };
}

function demoNotice(business: Business) {
  return business.isDemo
    ? { demoNotice: `${business.name} is a FICTIONAL demo business. Tell the user it is not real and no actual table will be held.` }
    : {};
}

const dateField = z.string().describe('Date in YYYY-MM-DD, in the business local time zone (Asia/Dubai). Resolve "tomorrow", "Friday" etc. using the localDate returned by get_opening_hours.');
const timeField = z.string().describe('Arrival time HH:MM, 24-hour, local time (e.g. "19:30"). Arrival times are on a fixed grid (see slotLengthMinutes).');
const partyField = z.number().int().describe('Number of guests including the person booking.');

export function buildServer(deps: ToolDeps): McpServer {
  const { business, store, rateLimiter } = deps;
  const now = deps.now ?? (() => new Date());
  const rules = business.bookingRules;

  const server = new McpServer(
    { name: `${business.id}-mcp`, title: business.name, version: VERSION },
    {
      instructions:
        `This server represents ${business.name} (${business.type}, ${business.address.area}, ${business.address.city}). ` +
        'Use get_business_info to describe it, get_opening_hours for "is it open" questions and for today\'s local date, ' +
        'search_menu for food and dietary questions, check_availability before request_booking, and get_booking_status to follow up. ' +
        'Booking requests are PENDING until the restaurant confirms them: never tell the user a table is confirmed.' +
        (business.isDemo ? ' This is a fictional demo business: say so to the user.' : ''),
    },
  );

  server.registerTool(
    'get_business_info',
    {
      title: 'Business info',
      description:
        `Everything needed to describe ${business.name}: what it is, cuisine, price range per person in AED, address, phone, ` +
        'languages, amenities, payment methods, weekly opening hours, booking rules and menu categories. ' +
        'Call this first when the user asks about the place in general. For live open/closed status use get_opening_hours; for dishes use search_menu.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      result({
        ...demoNotice(business),
        name: business.name,
        type: business.type,
        description: business.description,
        cuisine: business.cuisine,
        priceRange: business.priceRange,
        address: business.address,
        phone: business.phone,
        email: business.email,
        website: business.website,
        timezone: business.timezone,
        languages: business.languages,
        amenities: business.amenities,
        paymentMethods: business.paymentMethods,
        openingHours: business.openingHours,
        bookingRules: {
          maxPartySize: rules.maxPartySize,
          largeGroupNote: rules.largeGroupNote,
          arrivalSlotEveryMinutes: rules.slotLengthMinutes,
          minimumNoticeMinutes: rules.minimumNoticeMinutes,
          bookableDaysAhead: rules.maxDaysAhead,
          lastSeatingMinutesBeforeClose: rules.lastSeatingBeforeCloseMinutes,
          confirmation: 'Online requests are PENDING until the restaurant confirms them.',
        },
        menuCategories: [...new Set(business.menu.map((m) => m.category))],
        dietaryTagsUsed: DIETARY_TAGS.filter((t) => business.menu.some((m) => m.dietary.includes(t))),
      }),
  );

  server.registerTool(
    'get_opening_hours',
    {
      title: 'Opening hours',
      description:
        `Weekly opening hours plus whether ${business.name} is open RIGHT NOW in ${business.timezone} time, when it closes or next opens, ` +
        "and today's local date and weekday (use these to turn \"today\", \"tomorrow\" or \"this Friday\" into a YYYY-MM-DD date). " +
        'A close time earlier than the open time means it closes after midnight. Optionally pass a date to get that day\'s bookable arrival times.',
      inputSchema: z.object({
        date: z.string().optional().describe('Optional YYYY-MM-DD local date to list that day\'s bookable arrival times.'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ date }) => {
      const status = openStatus(business, now());
      const week = Object.fromEntries(WEEKDAYS.map((d) => [d, business.openingHours[d] ?? []]));
      const upcomingClosures = business.closures.filter((c) => c.date >= status.localDate);
      return result({
        ...demoNotice(business),
        timezone: business.timezone,
        now: status,
        weeklyHours: week,
        upcomingClosures,
        ...(date ? { arrivalTimesOn: { date, times: slotsOnDate(business, date).map((s) => s.time) } } : {}),
      });
    },
  );

  server.registerTool(
    'search_menu',
    {
      title: 'Search menu',
      description:
        'Search the menu by free text (matches English or Arabic names, description and category), dietary tag, and/or max price in AED. ' +
        'All filters are optional and combine with AND; call with no arguments to get the full menu. ' +
        `Dietary tags: ${DIETARY_TAGS.join(', ')}. "contains-nuts" marks dishes WITH nuts: for a nut allergy, exclude those with excludeTags. ` +
        'Tags come from the restaurant; for severe allergies tell the user to confirm with staff.',
      inputSchema: z.object({
        text: z.string().optional().describe('Words to match, e.g. "lamb", "dessert", "حمص".'),
        dietary: z.array(z.enum(DIETARY_TAGS)).optional().describe('Every listed tag must be present, e.g. ["vegan","gluten-free"].'),
        excludeTags: z.array(z.enum(DIETARY_TAGS)).optional().describe('Drop dishes with any of these tags, e.g. ["contains-nuts"].'),
        maxPriceAED: z.number().positive().optional().describe('Maximum price per dish in AED.'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ text, dietary, excludeTags, maxPriceAED }) => {
      const words = (text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const items = business.menu.filter((m) => {
        const hay = `${m.nameEn} ${m.nameAr} ${m.description} ${m.category}`.toLowerCase();
        return (
          words.every((w) => hay.includes(w)) &&
          (dietary ?? []).every((t) => m.dietary.includes(t)) &&
          !(excludeTags ?? []).some((t) => m.dietary.includes(t)) &&
          (maxPriceAED === undefined || m.priceAED <= maxPriceAED)
        );
      });
      return result({ ...demoNotice(business), currency: 'AED', count: items.length, items });
    },
  );

  server.registerTool(
    'check_availability',
    {
      title: 'Check table availability',
      description:
        'Check whether a table is free for a party at a date and time, and get the nearest open arrival times that day. ' +
        'Always call this before request_booking and offer the user the returned slots if their exact time is not available. ' +
        `Rules: up to ${rules.maxPartySize} guests, at least ${rules.minimumNoticeMinutes} minutes' notice, up to ${rules.maxDaysAhead} days ahead, ` +
        `arrival times every ${rules.slotLengthMinutes} minutes. If "problem" is set, explain it to the user in plain words.`,
      inputSchema: z.object({ date: dateField, time: timeField, partySize: partyField }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (req) => {
      const r = await checkAvailability(business, req, (d, t) => store.countActive(d, t), now());
      return result({ ...demoNotice(business), ...r });
    },
  );

  server.registerTool(
    'request_booking',
    {
      title: 'Request a booking',
      description:
        'Send a table booking REQUEST to the restaurant. It is stored as PENDING and returns a booking reference; the restaurant confirms or declines it later. ' +
        'NEVER tell the user the table is confirmed or guaranteed: say the request was sent, give them the reference, and say the restaurant will confirm (they can check with get_booking_status). ' +
        'Only call this after the user has explicitly agreed to the name, UAE phone number, date, time and party size. ' +
        'Phone must be a UAE number (+971 5X XXX XXXX mobile or +971 X XXX XXXX landline). ' +
        'If it fails, "code" says why and "alternativeSlots" lists times you can offer instead.',
      inputSchema: z.object({
        name: z.string().describe('Guest full name as they want it on the booking.'),
        phone: z.string().describe('Guest UAE phone number, any common format, e.g. "+971 50 123 4567" or "050 123 4567".'),
        date: dateField,
        time: timeField,
        partySize: partyField,
        notes: z.string().optional().describe('Optional requests: occasion, seating, high chair, allergies. Max 500 characters.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input, ctx) => {
      const ip = deps.clientKey(ctx?.http?.req);
      const limited = await rateLimiter.check([`ip:${ip}`, `phone:${input.phone.replace(/\D/g, '').slice(-9)}`]);
      if (!limited.ok) {
        return result(
          { code: 'RATE_LIMITED', message: `Too many booking requests. Try again in about ${Math.ceil(limited.retryAfterSeconds / 60)} minutes, or call ${business.phone}.` },
          true,
        );
      }
      const r = await requestBooking(business, store, input, now());
      if (!r.ok) return result({ ...demoNotice(business), status: 'NOT_CREATED', code: r.code, message: r.message, alternativeSlots: r.alternativeSlots }, true);
      const b = r.booking;
      return result({
        ...demoNotice(business),
        status: 'PENDING',
        reference: b.reference,
        message: `Booking request ${b.reference} sent to ${business.name}. It is PENDING: the restaurant will confirm. This is not a confirmed reservation yet.`,
        booking: { reference: b.reference, name: b.name, date: b.date, time: b.time, partySize: b.partySize, notes: b.notes },
        nextStep: 'Give the user the reference. They can ask you to check its status later with get_booking_status (reference + same phone number).',
      });
    },
  );

  server.registerTool(
    'get_booking_status',
    {
      title: 'Booking status',
      description:
        'Look up a booking request by its reference (e.g. "DK-7F3K2Q") AND the phone number used when booking. ' +
        'Status is PENDING (waiting for the restaurant), CONFIRMED (the restaurant accepted it) or DECLINED (not accepted; suggest another time). ' +
        'If not found, the reference or phone is wrong: ask the user to double-check both. Do not guess references.',
      inputSchema: z.object({
        reference: z.string().describe('Booking reference returned by request_booking.'),
        phone: z.string().describe('The same UAE phone number used for the booking.'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ reference, phone }) => {
      const b = await getBookingStatus(store, reference, phone);
      if (!b) return result({ found: false, message: 'No booking matches that reference and phone number.' }, true);
      return result({
        ...demoNotice(business),
        found: true,
        reference: b.reference,
        status: b.status,
        date: b.date,
        time: b.time,
        partySize: b.partySize,
        name: b.name,
        lastUpdated: b.updatedAt,
      });
    },
  );

  return server;
}
