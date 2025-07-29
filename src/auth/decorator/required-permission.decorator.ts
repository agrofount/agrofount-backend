import { SetMetadata } from '@nestjs/common';

export const RequiredPermissions = (...permissions: string[]) =>
  SetMetadata('permissions', permissions);
