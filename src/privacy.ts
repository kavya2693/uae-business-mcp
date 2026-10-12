// /privacy: plain-English privacy policy, generated from business.json.
// It describes what THIS code does. If you change what is collected or stored, update it.

import type { Business } from './config.js';
import { escapeHtml, page } from './html.js';
import { RETENTION_DAYS } from './storage/types.js';

export const POLICY_UPDATED = '2026-10-12';

export function privacyPage(business: Business): Response {
  const name = escapeHtml(business.name);
  const email = escapeHtml(business.email);
  const demo = business.isDemo
    ? `<p class="error">${name} is a fictional demo business. No real restaurant receives these requests. Please don't send real personal details.</p>`
    : '';

  return page(
    `Privacy · ${business.name}`,
    `<article>
<h1>Privacy policy</h1>
<p class="muted">${name} · AI assistant booking service · Last updated ${POLICY_UPDATED}</p>
${demo}

<p>This service lets AI assistants such as Claude and ChatGPT answer questions about ${name} and send table booking requests on your behalf. This page explains, in plain English, what we collect and what we do with it.</p>

<h2>The short version</h2>
<ul>
  <li>Asking about the menu, opening hours or availability collects nothing about you.</li>
  <li>If you ask to book a table, we store your name, phone number and booking details so the restaurant can confirm it.</li>
  <li>We don't sell your data, use it for advertising, or use it to train AI models.</li>
  <li>Booking records are deleted automatically ${RETENTION_DAYS} days after the booking date.</li>
</ul>

<h2>What we collect</h2>
<p><strong>When you request a booking</strong>, the AI assistant sends us:</p>
<ul>
  <li>your name</li>
  <li>your UAE phone number</li>
  <li>the date, time and number of guests</li>
  <li>any notes you add (for example an occasion, seating preference or allergy)</li>
</ul>
<p>Please only put in notes what the restaurant needs to know.</p>
<p><strong>Technical data.</strong> Your network (IP) address and phone number are used for a few minutes to stop abuse, by limiting how many booking requests can be sent. These counters expire after 10 minutes. Our hosting provider keeps standard server logs (such as time, address and page requested) for a short period for security and troubleshooting.</p>
<p><strong>What we don't get.</strong> We don't see your conversation with the AI assistant, only the specific details it sends to make or check a booking. We don't use cookies on this service. The only cookie is a sign-in cookie for restaurant staff on the admin page.</p>

<h2>Why we use it</h2>
<ul>
  <li>To pass your booking request to ${name} so staff can confirm or decline it.</li>
  <li>To let you (through your AI assistant) check the status of your request with your booking reference and phone number.</li>
  <li>To contact you about your booking if needed.</li>
  <li>To keep the service safe from spam and abuse.</li>
</ul>

<h2>Who can see it</h2>
<ul>
  <li><strong>${name} staff</strong>, through a password-protected admin page.</li>
  <li><strong>Service providers</strong> that run the service for us: our hosting provider (Vercel) and our database provider (Upstash). They process data only to provide their service to us.</li>
  <li><strong>Your AI assistant provider</strong> (for example Anthropic or OpenAI) handles your conversation under its own privacy policy, not this one.</li>
</ul>
<p>We don't sell or rent your data, and we don't share it with anyone else unless the law requires it.</p>
<p>Our providers may store data outside the UAE.</p>

<h2>How long we keep it</h2>
<p>Booking records are deleted automatically ${RETENTION_DAYS} days after the booking date. Abuse-prevention counters expire after 10 minutes.</p>

<h2>Your choices and rights</h2>
<p>You can ask us to:</p>
<ul>
  <li>show you the booking data we hold about you</li>
  <li>correct it</li>
  <li>delete it before the ${RETENTION_DAYS} days are up</li>
</ul>
<p>Email <a href="mailto:${email}">${email}</a> with your booking reference and phone number. We handle personal data with the UAE Personal Data Protection Law (Federal Decree-Law No. 45 of 2021) in mind.</p>

<h2>Children</h2>
<p>This service is meant for adults making restaurant bookings. Please don't submit bookings on behalf of children without a parent or guardian's involvement.</p>

<h2>Changes</h2>
<p>If we change how we handle your data, we'll update this page and the date at the top.</p>

<h2>Contact</h2>
<p>${name}, ${escapeHtml(business.address.line1)}, ${escapeHtml(business.address.city)}, ${escapeHtml(business.address.country)}.<br>
Email <a href="mailto:${email}">${email}</a> · Phone ${escapeHtml(business.phone)}</p>
</article>`,
  );
}
