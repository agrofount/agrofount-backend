import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterUserDto } from './create-user.dto';
import { ChangePasswordDto } from './change-password.dto';
import { ResetPasswordDto } from './reset-password.dto';
import { InviteAdminDto } from '../../admins/dto/create-admin.dto';
import { CUSTOMER_PASSWORD_MIN_LENGTH } from './password-policy';

const registerBase = {
  identifier: 'a@example.com',
  username: 'Farm',
  businessType: 'farmer',
  country: 'Nigeria',
  state: 'Lagos',
  city: 'Ikeja',
  gender: 'female',
};

async function errorsOn<T extends object>(
  type: new () => T,
  plain: Record<string, unknown>,
  property: string,
) {
  const errors = await validate(plainToInstance(type, plain));
  return errors.find((error) => error.property === property);
}

describe('customer password policy', () => {
  const short = 'a'.repeat(CUSTOMER_PASSWORD_MIN_LENGTH - 1);
  const exact = 'a'.repeat(CUSTOMER_PASSWORD_MIN_LENGTH);

  it('is eight characters', () => {
    expect(CUSTOMER_PASSWORD_MIN_LENGTH).toBe(8);
  });

  it.each([
    ['register', RegisterUserDto, registerBase, 'password'],
    [
      'change-password',
      ChangePasswordDto,
      { currentPassword: 'x' },
      'newPassword',
    ],
    ['reset-password', ResetPasswordDto, { token: 'abc' }, 'newPassword'],
  ] as const)(
    '%s rejects 7 characters and accepts 8',
    async (_n, type, base, field) => {
      const rejected = await errorsOn(
        type as any,
        { ...base, [field]: short },
        field,
      );
      expect(rejected?.constraints).toHaveProperty('minLength');
      expect(Object.values(rejected.constraints).join(' ')).toContain(
        'longer than or equal to 8 characters',
      );
      expect(
        await errorsOn(type as any, { ...base, [field]: exact }, field),
      ).toBeUndefined();
    },
  );

  it.each([
    ['register', RegisterUserDto, registerBase, 'password'],
    [
      'change-password',
      ChangePasswordDto,
      { currentPassword: 'x' },
      'newPassword',
    ],
    ['reset-password', ResetPasswordDto, { token: 'abc' }, 'newPassword'],
  ] as const)(
    '%s still accepts long passwords',
    async (_n, type, base, field) => {
      const value = 'Str0ng!Passw0rd-and-then-some';
      expect(
        await errorsOn(type as any, { ...base, [field]: value }, field),
      ).toBeUndefined();
    },
  );

  it('keeps admin passwords at twelve characters', async () => {
    const base = { email: 'admin@example.com', confirmPassword: 'x' };
    const eleven = await errorsOn(
      InviteAdminDto,
      { ...base, password: 'a'.repeat(11) },
      'password',
    );
    expect(eleven?.constraints).toHaveProperty('minLength');
    expect(
      await errorsOn(
        InviteAdminDto,
        { ...base, password: 'a'.repeat(12) },
        'password',
      ),
    ).toBeUndefined();
  });
});
