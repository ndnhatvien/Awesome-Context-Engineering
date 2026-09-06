# Architecture

The payment flow starts at `PaymentService.processPayment`, which validates
the incoming order, charges the card via `chargeCard`, computes tax with
`computeTax`, and finally issues a receipt.

Refunds are handled separately by the refund module through `processRefund`;
a card charge can also be voided with `voidPayment`.

End-to-end behavior is exercised by the integration tests under `tests/`,
such as `tests/paymentFlow.test.ts`.