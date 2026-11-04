import { Resend } from 'resend';

const BRAND_COLOR = '#1E3A5F';
const APP_URL = process.env.APP_URL || 'https://scanergy.krontiva.africa';
const FROM = process.env.EMAIL_FROM || 'Scarnergy <no-reply@krontiva.com>';

let resend: Resend | null = null;
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

// Best-effort: approval/rejection/invite must succeed regardless of whether
// the notification email goes out, so failures are logged, never thrown.
export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  const client = getResend();
  if (!client) {
    console.error(`[email] RESEND_API_KEY not set — skipped "${subject}" to ${to}`);
    return;
  }
  try {
    const { error } = await client.emails.send({ from: FROM, to, subject, html });
    if (error) console.error(`[email] Resend error sending "${subject}" to ${to}:`, error);
  } catch (err) {
    console.error(`[email] failed to send "${subject}" to ${to}:`, err);
  }
}

function wrapper(bodyHtml: string): string {
  return `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1f2937;">
    <img src="${APP_URL}/logo.png" alt="Scarnergy" width="56" height="56" style="border-radius: 12px; margin-bottom: 24px;" />
    ${bodyHtml}
    <p style="margin-top: 32px; font-size: 12px; color: #9ca3af;">— Scarnergy</p>
  </div>`;
}

// Recipients of all three emails below are inspector/supervisor accounts —
// the mobile app users, never web-admin accounts (those are created via a
// separate signup flow) — so these link/point to the Scarnergy mobile app,
// not the web dashboard. The app is TestFlight-only right now (not on the
// public App Store/Play Store yet), so there's no store link to give —
// just an instruction to open the already-installed app.
export function approvedEmail(fullName: string): string {
  return wrapper(`
    <h1 style="font-size: 20px; margin: 0 0 12px;">You're approved, ${fullName}</h1>
    <p style="font-size: 14px; line-height: 1.6;">Your Scarnergy account has been approved by an administrator. Open the Scarnergy app on your phone and sign in to get started.</p>
  `);
}

export function rejectedEmail(fullName: string): string {
  return wrapper(`
    <h1 style="font-size: 20px; margin: 0 0 12px;">Account request declined</h1>
    <p style="font-size: 14px; line-height: 1.6;">Hi ${fullName}, your request for access to Scarnergy was not approved. If you believe this is a mistake, please contact your organisation's administrator.</p>
  `);
}

export function credentialsEmail(fullName: string, email: string, password: string): string {
  return wrapper(`
    <h1 style="font-size: 20px; margin: 0 0 12px;">Welcome to Scarnergy, ${fullName}</h1>
    <p style="font-size: 14px; line-height: 1.6;">An administrator has created an account for you. Open the Scarnergy app on your phone and sign in with these credentials:</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; border-left: 3px solid ${BRAND_COLOR};">
      <tr>
        <td style="padding: 8px 12px; color: #6b7280;">Email</td>
        <td style="padding: 8px 12px; font-weight: 600;">${email}</td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; color: #6b7280;">Temporary password</td>
        <td style="padding: 8px 12px; font-weight: 600; font-family: monospace;">${password}</td>
      </tr>
    </table>
    <p style="font-size: 13px; line-height: 1.6; color: #6b7280;">For security, please sign in and change your password as soon as possible.</p>
  `);
}
