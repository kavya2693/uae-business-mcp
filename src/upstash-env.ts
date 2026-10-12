/** Upstash credentials. Vercel's Upstash integration may name them KV_REST_API_*, so accept both. */
export function upstashCredentials(): { url: string; token: string } | null {
  const e = process.env;
  const url = e.UPSTASH_REDIS_REST_URL || e.KV_REST_API_URL;
  const token = e.UPSTASH_REDIS_REST_TOKEN || e.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}
