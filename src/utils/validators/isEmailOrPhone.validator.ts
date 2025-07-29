import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'IsEmailOrPhone', async: false })
export class IsEmailOrPhone implements ValidatorConstraintInterface {
  validate(value: string): boolean {
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    const isPhone = /^[\+0-9]+$/.test(value);
    return isEmail || isPhone;
  }

  defaultMessage(): string {
    return 'Value must be a valid email or phone number.';
  }
}
