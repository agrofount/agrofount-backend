import { ConfigService } from '@nestjs/config';
import { PostcodeService } from './postcode.service';
import {
  MockPostcodeProvider,
  MOCK_POSTCODE_MISMATCH,
  MOCK_POSTCODE_NOT_FOUND,
  MOCK_POSTCODE_UNAVAILABLE,
} from './mock-postcode.provider';
import { selectPostcodeProvider } from './postcode.module';
import { NipostPostcodeProvider } from './nipost-postcode.provider';

const build = (state: any = null) => {
  const cache = new Map<string, unknown>();
  const cacheManager: any = {
    get: jest.fn(async (k: string) => cache.get(k)),
    set: jest.fn(async (k: string, v: unknown) => void cache.set(k, v)),
  };
  const stateRepo: any = { findOne: jest.fn().mockResolvedValue(state) };
  const config: any = { get: jest.fn().mockReturnValue(2) };
  return new PostcodeService(
    new MockPostcodeProvider(),
    stateRepo,
    cacheManager,
    config,
  );
};

describe('MockPostcodeProvider through PostcodeService', () => {
  it('resolves a Lagos address to the Lagos record', async () => {
    const result: any = await build().resolve({
      state: 'Lagos',
      city: 'Ikeja',
    });
    expect(result.status).toBe('verified');
    expect(result.postcode).toBe('LA01A01AB01');
    expect(result.record.street).toBe('1 Allen Avenue');
  });

  it('resolves Abuja, FCT and Federal Capital Territory to the FCT record', async () => {
    for (const state of ['Abuja', 'FCT', 'Federal Capital Territory']) {
      const result: any = await build().resolve({ state });
      expect(result.postcode).toBe('FC02A09DB09');
    }
  });

  it('echoes the typed state and city for other states', async () => {
    const result: any = await build().resolve({
      state: 'Kano',
      city: 'Nasarawa',
      street: '5 Test Road',
    });
    expect(result.status).toBe('verified');
    expect(result.postcode).toBe('KA01A01AB01');
    expect(result.record.state).toBe('Kano');
    expect(result.record.city).toBe('Nasarawa');
  });

  it('returns a known code from a direct lookup', async () => {
    const result: any = await build().resolve({ postcode: 'FC-02-A09-DB-09' });
    expect(result.status).toBe('verified');
    expect(result.record.lga).toBe('Municipal Area Council');
  });

  it('returns a complete record for any other valid code', async () => {
    const result: any = await build().resolve({ postcode: 'FC01A01LR01' });
    expect(result.status).toBe('verified');
    expect(JSON.stringify(result.record)).not.toMatch(/mock/i);
    expect(result.record).toMatchObject({
      postcode: 'FC01A01LR01',
      state: 'FCT',
      lga: 'Municipal Area Council',
      area: 'Garki',
      street: '12 Moshood Abiola Way',
    });
  });

  it('maps the magic codes to each outcome', async () => {
    const service = build();
    expect(
      await service.resolve({ postcode: MOCK_POSTCODE_NOT_FOUND }),
    ).toEqual({
      status: 'not_found',
    });
    expect(
      await service.resolve({ postcode: MOCK_POSTCODE_UNAVAILABLE }),
    ).toEqual({ status: 'unavailable' });
    const mismatch: any = await service.resolve({
      postcode: MOCK_POSTCODE_MISMATCH,
      state: 'Kano',
    });
    expect(mismatch.status).toBe('mismatch');
    expect(mismatch.mismatches).toEqual(['state']);
  });
});

describe('Oluyole sample code', () => {
  it('resolves OY03A05OL01 consistently with the product page location', async () => {
    const result: any = await build().resolve({ postcode: 'OY-03-A05-OL-01' });
    expect(result.status).toBe('verified');
    expect(result.record).toMatchObject({
      postcode: 'OY03A05OL01',
      state: 'Oyo',
      lga: 'Oluyole',
      latitude: 7.332,
      longitude: 3.868,
    });
  });
});

describe('FCT naming', () => {
  it('returns our state name and the id so the select can match, with no false mismatch', async () => {
    const service = build({ id: 'fct-id', name: 'Federal Capital Territory' });
    for (const typed of ['Abuja', 'FCT', 'Federal Capital Territory']) {
      const result: any = await service.resolve({
        postcode: 'FC02A09DB09',
        state: typed,
      });
      expect(result.status).toBe('verified');
      expect(result.stateId).toBe('fct-id');
      expect(result.record.state).toBe('Federal Capital Territory');
      expect(result.record.landmark).toBe('Opposite Garki Market');
    }
  });
});

describe('selectPostcodeProvider', () => {
  const config = (values: Record<string, string>) =>
    ({ get: (key: string) => values[key] } as unknown as ConfigService);

  it('uses the mock only when the flag is on', () => {
    expect(
      selectPostcodeProvider(
        config({ NIPOST_POSTCODE_MOCK: 'true', NODE_ENV: 'development' }),
        {} as any,
      ),
    ).toBeInstanceOf(MockPostcodeProvider);
    expect(
      selectPostcodeProvider(
        config({ NIPOST_POSTCODE_MOCK: 'false' }),
        {} as any,
      ),
    ).toBeInstanceOf(NipostPostcodeProvider);
  });

  it('refuses to start with the mock in production', () => {
    expect(() =>
      selectPostcodeProvider(
        config({ NIPOST_POSTCODE_MOCK: 'true', NODE_ENV: 'production' }),
        {} as any,
      ),
    ).toThrow(/production/);
  });
});
