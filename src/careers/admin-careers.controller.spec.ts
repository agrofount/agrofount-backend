import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminCareersController } from './admin-careers.controller';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminAuthGuard } from '../auth/guards/admin.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

describe('AdminCareersController security metadata', () => {
  it('requires JWT, admin, and roles guards on admin routes', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AdminCareersController);

    expect(guards).toEqual([JwtAuthGuard, AdminAuthGuard, RolesGuard]);
  });

  it('requires careers permissions on protected handlers', () => {
    const createJob = Object.getOwnPropertyDescriptor(
      AdminCareersController.prototype,
      'createJob',
    ).value;
    const publishJob = Object.getOwnPropertyDescriptor(
      AdminCareersController.prototype,
      'publishJob',
    ).value;

    expect(Reflect.getMetadata('permissions', createJob)).toEqual([
      'create_careers',
    ]);
    expect(Reflect.getMetadata('permissions', publishJob)).toEqual([
      'publish_careers',
    ]);
  });
});
