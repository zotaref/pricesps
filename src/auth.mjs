export const secretHeader = "X-Telegram-Bot-Api-Secret-Token";
export const tokenPattern = /^\d+:[A-Za-z0-9_-]{20,}$/;

export async function webhookSecret(token) {
  const bytes = new TextEncoder().encode("playstation-ua-price-bot/telegram-v1\n" + token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export function secretMatches(actual, expected) {
  if (typeof actual !== "string" || actual.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) {
    difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return difference === 0;
}
