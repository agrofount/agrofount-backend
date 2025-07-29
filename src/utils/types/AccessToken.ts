import { UserEntity } from '../../user/entities/user.entity';

export type AuthResult = {
  user: Partial<UserEntity>;
  accessToken: string;
};
