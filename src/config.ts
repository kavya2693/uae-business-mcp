import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as z from 'zod/v4';

export const DIETARY_TAGS = ['vegetarian', 'vegan', 'halal', 'gluten-free', 'contains-nuts'] as const;
export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM (24h)');

// A close time earlier than (or equal to) the open time means the interval runs past midnight.
const interval = z.object({ open: hhmm, close: hhmm });

const menuItem = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
  description: z.string().default(''),
  priceAED: z.number().positive(),
  dietary: z.array(z.enum(DIETARY_TAGS)).default([]),
});

export const businessSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'lowercase letters, digits and dashes only'),
  isDemo: z.boolean().default(false),
  name: z.string().min(1),
  type: z.string().default('restaurant'),
  description: z.string().default(''),
  cuisine: z.array(z.string()).default([]),
  priceRange: z.object({
    currency: z.literal('AED'),
    minPerPerson: z.number().nonnegative(),
    maxPerPerson: z.number().nonnegative(),
  }),
  address: z.object({
    line1: z.string(),
    area: z.string(),
    city: z.string(),
    country: z.string(),
    mapsUrl: z.string().url().optional(),
  }),
  phone: z.string().regex(/^\+971[\d ]{8,14}$/, 'expected +971 format'),
  email: z.string().email(),
  website: z.string().url().optional(),
  timezone: z.string().default('Asia/Dubai'),
  languages: z.array(z.string()).default([]),
  amenities: z.array(z.string()).default([]),
  paymentMethods: z.array(z.string()).default([]),
  openingHours: z.record(z.enum(WEEKDAYS), z.array(interval)),
  closures: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().optional() })).default([]),
  bookingRules: z.object({
    maxPartySize: z.number().int().positive(),
    largeGroupNote: z.string().default(''),
    slotLengthMinutes: z.number().int().positive(),
    tablesPerSlot: z.number().int().positive(),
    minimumNoticeMinutes: z.number().int().nonnegative(),
    maxDaysAhead: z.number().int().positive(),
    lastSeatingBeforeCloseMinutes: z.number().int().nonnegative().default(0),
    referencePrefix: z.string().regex(/^[A-Z]{1,4}$/),
  }),
  menu: z.array(menuItem).min(1),
});

export type Business = z.infer<typeof businessSchema>;
export type MenuItem = z.infer<typeof menuItem>;
export type DietaryTag = (typeof DIETARY_TAGS)[number];

export function parseBusiness(raw: unknown): Business {
  const result = businessSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid business config:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

let cached: Business | undefined;

export function loadBusiness(path = process.env.BUSINESS_CONFIG || 'business.json'): Business {
  if (!cached) {
    cached = parseBusiness(JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')));
  }
  return cached;
}
