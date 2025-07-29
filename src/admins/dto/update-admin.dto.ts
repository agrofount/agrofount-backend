import { PartialType } from '@nestjs/swagger';
import { RegisterUserDto } from '../../auth/dto/create-user.dto';

export class UpdateAdminDto extends PartialType(RegisterUserDto) {}
