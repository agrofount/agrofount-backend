import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { CUSTOMER_PASSWORD_MIN_LENGTH } from './password-policy';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(CUSTOMER_PASSWORD_MIN_LENGTH)
  newPassword: string;
}
