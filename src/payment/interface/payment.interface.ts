export interface PaymentStrategy {
  initializePayment(
    amount: number,
    currency: string,
    metadata?: any,
  ): Promise<any>;
  verifyPayment(reference: string): Promise<any>;
}
