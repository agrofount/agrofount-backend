import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { paginate, Paginated, PaginateQuery } from 'nestjs-paginate';
import { DataSource, Repository } from 'typeorm';
import { OutboxService } from '../outbox/outbox.service';
import { UploadService } from '../upload/upload.service';
import { CreateSellerInterestDto } from './dto/create-seller-interest.dto';
import { SellerInterestEntity } from './entities/seller-interest.entity';
import { SELLER_INTEREST_PAGINATION_CONFIG } from './config/seller-interest-pagination.config';
import { MessageTypes } from '../notification/types/notification.type';

const MAX_SAMPLES = 3;
const ADMIN_EMAIL_FALLBACK = 'dayo.akinbami@agrofount.com';

@Injectable()
export class SellerInterestService {
  constructor(
    @InjectRepository(SellerInterestEntity)
    private readonly repository: Repository<SellerInterestEntity>,
    private readonly dataSource: DataSource,
    private readonly uploadService: UploadService,
    private readonly outboxService: OutboxService,
    private readonly configService: ConfigService,
  ) {}

  async create(dto: CreateSellerInterestDto, files: Express.Multer.File[]) {
    if (!files?.length) {
      throw new BadRequestException('At least one product sample is required');
    }
    if (files.length > MAX_SAMPLES) {
      throw new BadRequestException(
        `A maximum of ${MAX_SAMPLES} product samples is allowed`,
      );
    }

    const interestId = randomUUID();
    const sampleAssetIds: string[] = [];
    let persisted = false;

    try {
      for (const file of files) {
        const asset = await this.uploadService.upload(
          interestId,
          'seller-sample',
          file.originalname,
          file.buffer,
        );
        sampleAssetIds.push(asset.id);
      }

      const sampleUrls = await Promise.all(
        sampleAssetIds.map(async (assetId) => {
          const result = await this.uploadService.getDownloadUrl(
            interestId,
            assetId,
            7 * 24 * 60 * 60,
          );
          return result.url;
        }),
      );
      const adminEmail =
        this.configService.get<string>('SELLER_INTEREST_ADMIN_EMAIL') ||
        ADMIN_EMAIL_FALLBACK;
      const messages = this.buildEmails(dto, interestId, sampleUrls);

      const result = await this.dataSource.transaction(async (manager) => {
        const sellerInterestRepo = manager.getRepository(SellerInterestEntity);
        const entity = sellerInterestRepo.create({
          id: interestId,
          ...dto,
          businessName: dto.businessName || null,
          businessType: dto.businessType || null,
          pricePerUnit: dto.pricePerUnit ?? null,
          additionalNotes: dto.additionalNotes || null,
          sampleAssetIds,
          notificationsQueuedAt: new Date(),
        });
        const saved = await sellerInterestRepo.save(entity);
        const sellerEmail = await this.outboxService.create(
          'email.custom',
          {
            recipient: { email: dto.email },
            subject: messages.seller.subject,
            htmlContent: messages.seller.html,
            textContent: messages.seller.text,
            replyTo: adminEmail,
            messageType: MessageTypes.SELLER_INTEREST_CONFIRMATION,
          },
          manager,
        );
        const adminNotification = await this.outboxService.create(
          'email.custom',
          {
            recipient: { email: adminEmail },
            subject: messages.admin.subject,
            htmlContent: messages.admin.html,
            textContent: messages.admin.text,
            replyTo: dto.email,
            messageType: MessageTypes.SELLER_INTEREST_ADMIN_NOTIFICATION,
          },
          manager,
        );
        return {
          saved,
          outboxIds: [sellerEmail.id, adminNotification.id],
        };
      });
      persisted = true;

      await Promise.all(
        result.outboxIds.map((outboxId) =>
          this.outboxService.dispatch(outboxId),
        ),
      );

      return result.saved;
    } catch (error) {
      if (!persisted) {
        await Promise.allSettled(
          sampleAssetIds.map((assetId) =>
            this.uploadService.remove(interestId, assetId),
          ),
        );
      }
      throw error;
    }
  }

  findAll(query: PaginateQuery): Promise<Paginated<SellerInterestEntity>> {
    return paginate(query, this.repository, {
      ...SELLER_INTEREST_PAGINATION_CONFIG,
    });
  }

  async findOne(id: string) {
    const interest = await this.repository.findOne({ where: { id } });
    if (!interest) throw new NotFoundException('Seller interest not found');

    const samples = await Promise.all(
      interest.sampleAssetIds.map((assetId) =>
        this.uploadService.getDownloadUrl(interest.id, assetId),
      ),
    );
    return { ...interest, samples };
  }

  private buildEmails(
    dto: CreateSellerInterestDto,
    interestId: string,
    sampleUrls: string[],
  ) {
    const value = (input?: string | number) =>
      this.escapeHtml(input === undefined ? 'Not provided' : String(input));
    const sampleLinks = sampleUrls
      .map(
        (url, index) =>
          `<li><a href="${this.escapeHtml(url)}">View sample ${
            index + 1
          }</a> (link expires in 7 days)</li>`,
      )
      .join('');
    const sellerSubject = 'We received your Agrofount seller interest';
    const adminSubject = `New seller interest: ${dto.productName}`;

    return {
      seller: {
        subject: sellerSubject,
        html: `<p>Hello ${value(
          dto.contactName,
        )},</p><p>Thank you for your interest in selling on Agrofount. We received the details for <strong>${value(
          dto.productName,
        )}</strong> and our team will contact you after reviewing the submission.</p><p>Reference: <strong>${value(
          interestId,
        )}</strong></p><p>Agrofount</p>`,
        text: `Hello ${dto.contactName},\n\nThank you for your interest in selling on Agrofount. We received the details for ${dto.productName}. Our team will contact you after reviewing the submission.\n\nReference: ${interestId}\n\nAgrofount`,
      },
      admin: {
        subject: adminSubject,
        html: `<h2>New seller interest</h2><p><strong>Reference:</strong> ${value(
          interestId,
        )}</p><h3>Contact details</h3><ul><li>Name: ${value(
          dto.contactName,
        )}</li><li>Email: ${value(dto.email)}</li><li>Phone: ${value(
          dto.phone,
        )}</li><li>Business: ${value(
          dto.businessName,
        )}</li><li>Business type: ${value(
          dto.businessType,
        )}</li><li>Location: ${value(
          dto.location,
        )}</li></ul><h3>Product details</h3><ul><li>Product: ${value(
          dto.productName,
        )}</li><li>Category: ${value(
          dto.productCategory,
        )}</li><li>Quantity: ${value(dto.quantityAvailable)} ${value(
          dto.unit,
        )}</li><li>Price per unit: ${value(
          dto.pricePerUnit,
        )}</li></ul><p><strong>Description:</strong><br>${value(
          dto.productDescription,
        )}</p><p><strong>Additional notes:</strong><br>${value(
          dto.additionalNotes,
        )}</p><h3>Samples</h3><ul>${sampleLinks}</ul>`,
        text: `New seller interest\nReference: ${interestId}\nName: ${
          dto.contactName
        }\nEmail: ${dto.email}\nPhone: ${dto.phone}\nBusiness: ${
          dto.businessName || 'Not provided'
        }\nBusiness type: ${dto.businessType || 'Not provided'}\nLocation: ${
          dto.location
        }\nProduct: ${dto.productName}\nCategory: ${
          dto.productCategory
        }\nQuantity: ${dto.quantityAvailable} ${dto.unit}\nPrice per unit: ${
          dto.pricePerUnit ?? 'Not provided'
        }\nDescription: ${dto.productDescription}\nAdditional notes: ${
          dto.additionalNotes || 'Not provided'
        }\nSamples: ${sampleUrls.join(', ')}`,
      },
    };
  }

  private escapeHtml(value: string): string {
    return value.replace(
      /[&<>'"]/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          "'": '&#39;',
          '"': '&quot;',
        }[character]),
    );
  }
}
