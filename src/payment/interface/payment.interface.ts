export interface PaymentStrategy {
  initializePayment(
    amount: number,
    currency: string,
    email: string,
    reference: string,
    metadata?: Record<string, any>,
  ): Promise<any>;
  verifyPayment(reference: string): Promise<any>;
  createRefund(
    reference: string,
    amountMinor: string,
    currency: string,
  ): Promise<any>;
}
