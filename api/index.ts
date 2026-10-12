// Vercel Function entry. vercel.json rewrites every path here; src/app.ts routes it.
import { handle } from '../src/app.js';

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const OPTIONS = handle;
export const HEAD = handle;
