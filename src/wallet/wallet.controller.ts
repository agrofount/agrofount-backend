import { Controller, Get, Put, UseGuards } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CurrentUser } from 'src/utils/decorators/current-user.decorator';
import { UserEntity } from 'src/user/entities/user.entity';

@Controller('wallet')
@ApiTags('Wallet')
@UseGuards(JwtAuthGuard) // Apply any necessary guards here, e.g., JwtAuthGuard
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get(':id')
  findOne(@CurrentUser() user: UserEntity): Promise<any> {
    return this.walletService.getWalletByUserId(user.id);
  }

  @Put(':id/freeze')
  freezeWallet(@CurrentUser() user: UserEntity): Promise<any> {
    return this.walletService.freezeWallet(user.id);
  }
}
