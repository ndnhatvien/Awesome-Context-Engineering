import { processRefund, voidPayment } from '../src/refund.js';
import PaymentService from '../src/paymentService.js';

describe('payment flow', () => {
  it('processes an order end to end', async () => {
    const service = new PaymentService(0);
    await service.processPayment('order-1', 2500);
    expect(service.openBalance).toBeGreaterThan(0);
  });

  it('voids a payment marker', () => {
    expect(voidPayment('order-2')).toContain('VOIDED');
  });
});