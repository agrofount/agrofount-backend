import { BadRequestException } from '@nestjs/common';
import { UploadService } from './upload.service';

describe('UploadService content verification', () => {
  const service = Object.create(UploadService.prototype) as UploadService;

  it('accepts a PNG by magic bytes', () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);
    expect((service as any).detectImage(png)).toEqual({
      contentType: 'image/png',
      extension: 'png',
    });
  });

  it('rejects content whose claimed extension cannot be trusted', () => {
    expect(() => (service as any).detectImage(Buffer.from('%PDF-1.7'))).toThrow(
      BadRequestException,
    );
  });

  it('accepts a PDF CV by extension and magic bytes', () => {
    expect(
      (service as any).detectDocument(Buffer.from('%PDF-1.7'), 'cv.pdf'),
    ).toEqual({
      contentType: 'application/pdf',
      extension: 'pdf',
    });
  });

  it('rejects a renamed executable as a CV', () => {
    expect(() =>
      (service as any).detectDocument(Buffer.from('MZ fake exe'), 'cv.pdf'),
    ).toThrow(BadRequestException);
  });
});
