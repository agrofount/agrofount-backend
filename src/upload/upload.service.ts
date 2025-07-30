import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { fromEnv } from '@aws-sdk/credential-provider-env';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import * as promiseRetry from 'promise-retry';

@Injectable()
export class UploadService {
  private readonly s3Client: S3Client;

  constructor(private readonly configService: ConfigService) {
    const accessKeyId = this.configService
      .get<string>('AWS_ACCESS_KEY_ID')
      .trim();
    const secretAccessKey = this.configService
      .get<string>('AWS_SECRET_ACCESS_KEY')
      .trim();

    this.s3Client = new S3Client({
      region: this.configService.getOrThrow<string>('AWS_S3_REGION'),
    });
  }
  async upload(name: string, buffer: Buffer, clientId: string, server: Server) {
    const bucketName = this.configService.getOrThrow<string>('AWS_BUCKET_NAME');
    const imageUrl = `https://${bucketName}.s3.${this.configService.getOrThrow<string>(
      'AWS_S3_REGION',
    )}.amazonaws.com/${name}`;

    try {
      // Check if the object already exists
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: bucketName,
          Key: name,
        }),
      );

      // If the object exists, return the URL
      console.log(`Image already exists: ${imageUrl}`);
      return imageUrl;
    } catch (error) {
      console.error('S3 HeadObjectCommand Error:', error);
      if (error.name !== 'NotFound') {
        console.error('Error checking if object exists:', error);
        throw error;
      }

      // If the object does not exist, proceed with the upload
      console.log('Uploading image to S3:', bucketName, name, buffer);
      const uploadFile = async () => {
        const upload = new Upload({
          client: this.s3Client,
          params: {
            Bucket: bucketName,
            Key: name,
            Body: buffer,
          },
          partSize: 10 * 1024 * 1024, // 10MB part size (adjust as needed)
          queueSize: 8, // Increase queue size to allow more concurrent uploads
        });

        upload.on('httpUploadProgress', (progress) => {
          const percentage = Math.round(
            (progress.loaded / progress.total) * 100,
          );
          console.log(`Upload progress: ${percentage}%`);
          server.to(clientId).emit('uploadProgress', { name, percentage });
        });

        await upload.done();
      };

      try {
        await promiseRetry(
          (retry, attempt) => {
            console.log(`Upload attempt ${attempt}`);
            return uploadFile().catch(retry);
          },
          {
            retries: 3,
            minTimeout: 1000,
          },
        );
        return imageUrl;
      } catch (error) {
        console.error('Error during upload:', error);
        throw error;
      }
    }
  }
}
