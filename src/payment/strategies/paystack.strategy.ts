import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentStrategy } from '../interface/payment.interface';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class PaystackStrategy implements PaymentStrategy {
  private readonly paystackSecretKey: string;
  private readonly paystackUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.paystackSecretKey = this.configService.get<string>(
      'PAYSTACK_SECRET_KEY',
    );
    this.paystackUrl = this.configService.get<string>('PAYSTACK_URL');
  }

  async initializePayment(
    amount: number,
    currency: string,
    email: string,
    metadata?: any,
  ): Promise<any> {
    const url = `${this.paystackUrl}/transaction/initialize`;
    const headers = {
      Authorization: `Bearer ${this.paystackSecretKey}`,
      'Content-Type': 'application/json',
    };

    const data = {
      amount: Math.round(amount * 100), // Paystack expects amount in kobo
      email: email || 'support@agrofount.com',
      currency,
      metadata,
    };

    try {
      const response = await lastValueFrom(
        this.httpService.post(url, data, { headers }),
      );
      return response.data;
    } catch (error) {
      console.error(error);
      throw new InternalServerErrorException(
        'Failed to initialize payment with Paystack',
      );
    }
  }

  async verifyPayment(reference: string): Promise<any> {
    const url = `${this.paystackUrl}/transaction/verify/${reference}`;
    const headers = {
      Authorization: `Bearer ${this.paystackSecretKey}`,
    };

    try {
      const response = await this.httpService.get(url, { headers }).toPromise();
      return response.data;
    } catch (error) {
      console.error(error);
      throw new InternalServerErrorException(
        'Failed to verify payment with Paystack',
      );
    }
  }
}
