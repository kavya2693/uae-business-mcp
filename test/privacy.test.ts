import { describe, expect, it } from 'vitest';
import { loadBusiness } from '../src/config.js';
import { privacyPage } from '../src/privacy.js';

describe('/privacy', () => {
  it('names the business, retention period, contact email and demo notice', async () => {
    const business = loadBusiness();
    const res = privacyPage(business);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Demo Kitchen, Dubai Marina');
    expect(html).toContain('90 days after the booking date');
    expect(html).toContain(`mailto:${business.email}`);
    expect(html).toContain('fictional demo business');
    expect(html).toContain('train AI');
  });

  it('omits the demo notice for a real business', async () => {
    const html = await privacyPage({ ...loadBusiness(), isDemo: false }).text();
    expect(html).not.toContain('fictional demo business');
  });
});
