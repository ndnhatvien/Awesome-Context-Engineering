import PaymentService from './paymentService.js';
import { processRefund } from './refund.js';

/**
 * Application entry point wiring everything together.
 */
export async function main(): Promise<void> {
  const service = new PaymentService(100);
  await service.processPayment('order-1', 2500);
  await processRefund('refund-1', 500);
}

if (process.env.NODE_ENV === 'cli') {
  void main();
}