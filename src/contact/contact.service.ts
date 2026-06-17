import { Injectable } from '@nestjs/common';
import { CreateContactDto } from './dto/create-contact.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { ContactEntity } from './entities/contact.entity';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { NotificationService } from '../notification/notification.service';
import {
  MessageTypes,
  NotificationChannels,
} from '../notification/types/notification.type';

@Injectable()
export class ContactService {
  constructor(
    @InjectRepository(ContactEntity)
    private contactRepo: Repository<ContactEntity>,
    private readonly configService: ConfigService,
    private readonly notificationService: NotificationService,
  ) {}

  async create(dto: CreateContactDto) {
    const { email, name } = dto;
    const contact = this.contactRepo.create(dto);

    const savedContact = await this.contactRepo.save(contact);
    await Promise.allSettled([
      this.notificationService.sendNotification(
        NotificationChannels.EMAIL,
        { email },
        MessageTypes.CONTACT_US,
        {
          user_name: name,
          user_message: contact.message,
          support_link: 'https://agrofount.com/help',
        },
      ),
      this.notificationService.sendNotification(
        NotificationChannels.EMAIL,
        {
          email:
            this.configService.get<string>('CONTACT_SUPPORT_EMAIL') ||
            this.configService.get<string>('SENDGRID_FROM_EMAIL'),
        },
        MessageTypes.CONTACT_US_ADMIN,
        {
          user_name: name,
          user_email: email,
          user_phone: contact.phone,
          user_message: contact.message,
        },
      ),
    ]);

    return savedContact;
  }
}
