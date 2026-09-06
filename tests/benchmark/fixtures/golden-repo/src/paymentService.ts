import { chargeCard } from './cardProcessor.js';
import { computeTax } from './tax.js';
import { issueReceipt } from './receipt.js';

/**
 * Orchestrates a full payment lifecycle.
 */
export class PaymentService {
  openBalance: number;

  constructor(startingBalance = 0) {
    this.openBalance = startingBalance;
  }

  async processPayment(orderId: string, amountInCents: number): Promise<string> {
    const tax = computeTax(amountInCents);
    await chargeCard(orderId, amountInCents + tax);
    const receipt = await issueReceipt(orderId);
    this.openBalance += amountInCents + tax;
    return receipt;
  }
}

export default PaymentService;