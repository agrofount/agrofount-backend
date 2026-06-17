import {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { Server } from 'socket.io';
import { MoreThan, Repository } from 'typeorm';
import {
  UploadAssetEntity,
  UploadAssetStatus,
} from './entities/upload-asset.entity';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_UPLOADS_PER_DAY = 50;

@Injectable()
export class UploadService {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;

  constructor(
    configService: ConfigService,
    @InjectRepository(UploadAssetEntity)
    private readonly assetRepository: Repository<UploadAssetEntity>,
  ) {
    this.bucketName = configService.getOrThrow<string>('AWS_BUCKET_NAME');
    this.s3Client = new S3Client({
      region: configService.getOrThrow<string>('AWS_S3_REGION'),
    });
  }

  async upload(
    ownerId: string,
    purpose: string,
    originalName: string,
    buffer: Buffer,
    server?: Server,
  ) {
    this.assertFileSize(buffer);
    return this.uploadVerifiedFile(
      ownerId,
      purpose,
      originalName,
      buffer,
      this.detectImage(buffer),
      server,
    );
  }

  async uploadDocument(
    ownerId: string,
    purpose: string,
    originalName: string,
    buffer: Buffer,
    server?: Server,
  ) {
    this.assertFileSize(buffer);
    return this.uploadVerifiedFile(
      ownerId,
      purpose,
      originalName,
      buffer,
      this.detectDocument(buffer, originalName),
      server,
    );
  }

  private async uploadVerifiedFile(
    ownerId: string,
    purpose: string,
    originalName: string,
    buffer: Buffer,
    detected: { contentType: string; extension: string },
    server?: Server,
  ) {
    this.assertFileSize(buffer);
    const recentUploads = await this.assetRepository.count({
      where: {
        ownerId,
        createdAt: MoreThan(new Date(Date.now() - 24 * 60 * 60 * 1000)),
      },
    });
    if (recentUploads >= MAX_UPLOADS_PER_DAY) {
      throw new BadRequestException('Daily upload quota exceeded');
    }

    const checksum = createHash('sha256').update(buffer).digest('hex');
    const assetId = randomUUID();
    const objectKey = `private/${ownerId}/${purpose}/${new Date()
      .toISOString()
      .slice(0, 10)}/${assetId}.${detected.extension}`;
    const asset = await this.assetRepository.save(
      this.assetRepository.create({
        id: assetId,
        ownerId,
        purpose,
        objectKey,
        originalName: this.safeFilename(originalName),
        contentType: detected.contentType,
        sizeBytes: String(buffer.length),
        checksum,
        status: UploadAssetStatus.Pending,
      }),
    );

    try {
      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: this.bucketName,
          Key: objectKey,
          Body: buffer,
          ContentType: detected.contentType,
          ContentLength: buffer.length,
          ServerSideEncryption: 'AES256',
          CacheControl: 'private, max-age=300',
          ContentDisposition: `inline; filename="${asset.originalName}"`,
          Metadata: { ownerId, assetId, checksum, purpose },
        },
        queueSize: 2,
        partSize: MAX_FILE_BYTES,
        leavePartsOnError: false,
      });
      upload.on('httpUploadProgress', (progress) => {
        const percentage = Math.round(
          progress.total
            ? (Number(progress.loaded) / Number(progress.total)) * 100
            : 0,
        );
        server?.to(`upload:${ownerId}`).emit('uploadProgress', {
          assetId,
          percentage,
        });
      });
      await upload.done();
      asset.status = UploadAssetStatus.Available;
      asset.failureReason = null;
      await this.assetRepository.save(asset);
      return this.response(asset);
    } catch (error) {
      await this.assetRepository.update(asset.id, {
        status: UploadAssetStatus.Failed,
        failureReason: String(error?.message || error).slice(0, 2_000),
      });
      throw error;
    }
  }

  async getDownloadUrl(
    ownerId: string,
    assetId: string,
    expiresInSeconds = 300,
  ) {
    const asset = await this.findOwned(ownerId, assetId);
    const expiresIn = Math.min(
      Math.max(Math.trunc(expiresInSeconds), 60),
      7 * 24 * 60 * 60,
    );
    const url = await getSignedUrl(
      this.s3Client,
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: asset.objectKey,
        ResponseContentType: asset.contentType,
        ResponseContentDisposition: `inline; filename="${asset.originalName}"`,
      }),
      { expiresIn },
    );
    return { ...this.response(asset), url, expiresInSeconds: expiresIn };
  }

  async remove(ownerId: string, assetId: string) {
    const asset = await this.findOwned(ownerId, assetId);
    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: asset.objectKey,
      }),
    );
    asset.status = UploadAssetStatus.Deleted;
    await this.assetRepository.save(asset);
    return { success: true };
  }

  private async findOwned(ownerId: string, assetId: string) {
    const asset = await this.assetRepository.findOne({
      where: {
        id: assetId,
        ownerId,
        status: UploadAssetStatus.Available,
      },
    });
    if (!asset) throw new NotFoundException('Upload not found');
    return asset;
  }

  private detectImage(buffer: Buffer) {
    if (
      buffer.length >= 3 &&
      buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    ) {
      return { contentType: 'image/jpeg', extension: 'jpg' };
    }
    if (
      buffer.length >= 8 &&
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
      return { contentType: 'image/png', extension: 'png' };
    }
    if (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return { contentType: 'image/webp', extension: 'webp' };
    }
    throw new BadRequestException(
      'Only verified JPEG, PNG, and WebP images are accepted',
    );
  }

  private assertFileSize(buffer: Buffer) {
    if (!buffer.length || buffer.length > MAX_FILE_BYTES) {
      throw new BadRequestException('File must be between 1 byte and 5 MB');
    }
  }

  private detectDocument(buffer: Buffer, originalName: string) {
    const extension = originalName.split('.').pop()?.toLowerCase();

    if (
      extension === 'pdf' &&
      buffer.length >= 5 &&
      buffer.subarray(0, 5).toString('ascii') === '%PDF-'
    ) {
      return { contentType: 'application/pdf', extension: 'pdf' };
    }

    const oleHeader = Buffer.from([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    ]);
    if (
      extension === 'doc' &&
      buffer.length >= oleHeader.length &&
      buffer.subarray(0, oleHeader.length).equals(oleHeader)
    ) {
      return { contentType: 'application/msword', extension: 'doc' };
    }

    if (
      extension === 'docx' &&
      buffer.length >= 4 &&
      buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    ) {
      return {
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        extension: 'docx',
      };
    }

    throw new BadRequestException(
      'Only verified PDF, DOC, and DOCX documents are accepted',
    );
  }

  private safeFilename(value: string): string {
    const normalized = value
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 255);
    return normalized || 'upload';
  }

  private response(asset: UploadAssetEntity) {
    return {
      id: asset.id,
      purpose: asset.purpose,
      contentType: asset.contentType,
      sizeBytes: asset.sizeBytes,
      checksum: asset.checksum,
      status: asset.status,
      createdAt: asset.createdAt,
    };
  }
}
