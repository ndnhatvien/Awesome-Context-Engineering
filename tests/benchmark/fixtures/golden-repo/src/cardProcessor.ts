/**
 * Card charging primitives.
 */
export class CardProcessor {
  private gatewayUrl: string;

  constructor(gatewayUrl: string) {
    this.gatewayUrl = gatewayUrl;
  }

  tokenize(cardNumber: string): string {
    return cardNumber.split('').reverse().join('');
  }
}

export function chargeCard(orderId: string, amountInCents: number): Promise<string> {
  const processor = new CardProcessor('https://payments.internal/gateway');
  const token = processor.tokenize(`card-${orderId}`);
  return Promise.resolve(`${token}:${amountInCents}:charged`);
}

export function refundCard(refundId: string, amountInCents: number): Promise<string> {
  return Promise.resolve(`refunded-${refundId}-${amountInCents}`);
}