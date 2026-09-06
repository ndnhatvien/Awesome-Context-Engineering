import { computeTax } from './tax.js';

export function issueReceipt(orderId: string): Promise<string> {
  const stamp = `receipt-${orderId}-${Date.now()}`;
  return Promise.resolve(stamp);
}

export function applyDiscount(base: number, rate: number): number {
  return base * rate * computeTax(base);
}