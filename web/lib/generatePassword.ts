import { randomInt } from 'node:crypto';

// Excludes visually ambiguous characters (0/O, 1/l/I) since this is read off
// an email and typed in by hand on first login.
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

export function generatePassword(length = 12): string {
  let password = '';
  for (let i = 0; i < length; i++) {
    password += CHARS[randomInt(CHARS.length)];
  }
  return password;
}
