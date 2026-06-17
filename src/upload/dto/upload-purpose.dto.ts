import { IsIn } from 'class-validator';

export class UploadPurposeDto {
  @IsIn(['profile', 'product', 'review', 'other'])
  purpose: string;
}
