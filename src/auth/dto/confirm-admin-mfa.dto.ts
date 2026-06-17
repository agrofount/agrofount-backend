import { IsString, IsUUID, Matches } from 'class-validator';

export class ConfirmAdminMfaDto {
  @IsUUID()
  challengeId: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}
