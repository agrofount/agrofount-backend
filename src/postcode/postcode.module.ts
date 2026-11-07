import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpModule, HttpService } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StateEntity } from '../state/entities/state.entity';
import { PostcodeController } from './postcode.controller';
import { PostcodeService } from './postcode.service';
import { PostcodeProvider } from './postcode.types';
import { NipostPostcodeProvider } from './nipost-postcode.provider';
import { MockPostcodeProvider } from './mock-postcode.provider';

/** NIPOST_POSTCODE_MOCK=true swaps in the deterministic mock provider. */
export const selectPostcodeProvider = (
  configService: ConfigService,
  httpService: HttpService,
): PostcodeProvider => {
  const mock =
    String(configService.get('NIPOST_POSTCODE_MOCK') ?? '').toLowerCase() ===
    'true';
  if (mock) return new MockPostcodeProvider();
  return new NipostPostcodeProvider(configService, httpService);
};

@Module({
  imports: [
    TypeOrmModule.forFeature([StateEntity]),
    HttpModule.register({ timeout: 5_000, maxRedirects: 0 }),
  ],
  controllers: [PostcodeController],
  providers: [
    PostcodeService,
    {
      provide: PostcodeProvider,
      useFactory: selectPostcodeProvider,
      inject: [ConfigService, HttpService],
    },
  ],
  exports: [PostcodeService],
})
export class PostcodeModule {}
