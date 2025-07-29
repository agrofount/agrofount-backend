import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { CreateSubscriberDto } from './dto/create-subscriber.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { SubscriberEntity } from './entities/subscriber.entity';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { NotificationService } from '../notification/notification.service';
import {
  MessageTypes,
  NotificationChannels,
} from 'src/notification/types/notification.type';

@Injectable()
export class SubscriberService {
  constructor(
    @InjectRepository(SubscriberEntity)
    private readonly subscriberRepository: Repository<SubscriberEntity>,
    private readonly configService: ConfigService,
    @Inject('SEND_IN_BLUE') private readonly sendInBlue,
    private readonly notificationService: NotificationService,
  ) {}

  async create(dto: CreateSubscriberDto) {
    const { email } = dto;
    let subscriber = await this.subscriberRepository.findOneBy({ email });

    if (subscriber) throw new ConflictException('Email already subscribed');

    const subscriberEntity = this.subscriberRepository.create(dto);

    subscriber = await this.subscriberRepository.save(subscriberEntity);

    const frontendUrl = this.configService.get<string>('app.frontend_url');
    const shopUrl = `${frontendUrl}/shop`;

    this.notificationService.sendNotification(
      NotificationChannels.EMAIL,
      { email },
      MessageTypes.SUBSCRIPTION_EMAIL,
      {
        shop_link: shopUrl,
      },
    );

    return {
      success: true,
      message: 'Thanks for subscribing.',
      data: subscriber,
    };
  }

  findAll() {
    return `This action returns all subscriber`;
  }

  findOne(id: number) {
    return `This action returns a #${id} subscriber`;
  }
}
