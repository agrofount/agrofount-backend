export enum PaymentStatus {
  Pending = 'pending',
  Partial = 'partial',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
  Refunded = 'refunded',
  RefundPending = 'refund_pending',
}

export enum PaymentMethod {
  CashOnDelivery = 'cash_on_delivery',
  PayNow = 'pay_now',
  BankTransfer = 'bank_transfer',
  PayLater = 'pay_later',
  Wallet = 'wallet',
}

export enum PaymentChannel {
  Paystack = 'paystack',
  Flutterwave = 'flutterwave',
  Stripe = 'stripe',
}
