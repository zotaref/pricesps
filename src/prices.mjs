// Thresholds from Y8:Y11, markups from E8:I8, and conversion from D3.
const priceBands = [[501, 80], [1001, 90], [2001, 140], [2501, 200]];
export const rateTenths = 433;

export function calculatePrice(priceCents) {
  if (!Number.isSafeInteger(priceCents) || priceCents < 0) {
    throw new Error("Invalid price in kopiykas");
  }
  // A8 maps a zero-price input back to zero after the markup formula.
  if (priceCents === 0) return { totalCents: 0, convertedCents: 0 };

  const band = priceBands.find(([limit]) => priceCents < limit * 100);
  const totalCents = priceCents + (band ? band[1] : 275) * 100;
  const convertedCents = Math.round((totalCents * 10) / rateTenths);
  return { totalCents, convertedCents };
}

const formatter = new Intl.NumberFormat("uk-UA", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCents(cents) {
  return formatter.format(cents / 100);
}
