export function computeTax(amountInCents: number): number {
  const rate = 0.1;
  return Math.round(amountInCents * rate);
}