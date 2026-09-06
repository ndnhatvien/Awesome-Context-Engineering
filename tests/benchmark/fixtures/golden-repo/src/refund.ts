import { refundCard } from './cardProcessor.js';

/**
 * Handles incoming refund requests.
 */
export async function processRefund(refundId: string, amountInCents: number): Promise<string> {
  const ledgerEntry = await refundCard(refundId, amountInCents);
  return `ledger:${ledgerEntry}`;
}

export function voidPayment(orderId: string): string {
  const marker = `voided-order-${orderId}`;
  return marker.toUpperCase();
}

export default processRefund;