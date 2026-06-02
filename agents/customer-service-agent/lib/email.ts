// lib/email.ts — minimal SendGrid sender (admin OTP only).
//
// No SDK — a single fetch to the SendGrid v3 API. Used solely to email the /admin
// one-time code. Returns false (never throws) if unconfigured or on failure, so the
// caller can degrade without leaking whether a send happened.
const apiKey = () => process.env.SENDGRID_API_KEY || '';
const fromEmail = () => process.env.SENDGRID_FROM_EMAIL || 'noreply@nemorouter.ai';
const fromName = () => process.env.SENDGRID_FROM_NAME || 'Nemo Router';

export function emailConfigured(): boolean {
  return Boolean(process.env.SENDGRID_API_KEY);
}

export async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<boolean> {
  const key = apiKey();
  if (!key) return false;
  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: fromEmail(), name: fromName() },
        subject,
        content: [
          { type: 'text/plain', value: text },
          ...(html ? [{ type: 'text/html', value: html }] : []),
        ],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
