import { BadRequestException, Injectable } from '@nestjs/common';

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /reveal\s+(the\s+)?system\s+prompt/i,
  /developer\s+message/i,
  /bypass\s+(policy|safety|permission)/i,
  /tool\s+call.*without\s+permission/i,
];

@Injectable()
export class AiSecurityService {
  sanitizeInput(value: string, maxLength = 2000): string {
    const sanitized = String(value || '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!sanitized) {
      throw new BadRequestException('Message is required');
    }

    if (sanitized.length > maxLength) {
      throw new BadRequestException(
        `Message must not exceed ${maxLength} characters`,
      );
    }

    return sanitized;
  }

  detectPromptInjection(value: string): boolean {
    return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(value));
  }

  maskPii(value: unknown): unknown {
    if (typeof value === 'string') {
      return value
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
        .replace(/(\+?234|0)?[789][01]\d{8}/g, '[phone]');
    }

    if (Array.isArray(value)) return value.map((item) => this.maskPii(item));

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [
          key,
          this.isSensitiveKey(key) ? '[redacted]' : this.maskPii(item),
        ]),
      );
    }

    return value;
  }

  private isSensitiveKey(key: string): boolean {
    return /password|token|secret|authorization|cookie|email|phone/i.test(key);
  }
}
