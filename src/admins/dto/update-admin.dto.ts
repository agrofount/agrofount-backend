import { OmitType, PartialType } from '@nestjs/swagger';
import { InviteAdminDto } from './create-admin.dto';
import { RoleEntity } from '../../role/entities/role.entity';

export class UpdateAdminDto extends PartialType(
  OmitType(InviteAdminDto, ['password', 'confirmPassword'] as const),
) {
  updatedBy?: string;
  roles?: RoleEntity[];
}
