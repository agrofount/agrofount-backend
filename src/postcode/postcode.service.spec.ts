import { BadRequestException } from '@nestjs/common';
import { PostcodeService } from './postcode.service';
import { OrderService } from '../order/order.service';

const refs = {
  states: jest.fn().mockResolvedValue([{ code: 'LA', name: 'Lagos' }]),
  lgas: jest.fn().mockResolvedValue([{ code: '01', name: 'Ikeja' }]),
};
const record = {
  postcode: 'LA01A01AB01',
  state: 'Lagos',
  lga: 'Ikeja',
  area: 'Allen',
  latitude: 6.6,
  longitude: 3.3,
};

describe('PostcodeService', () => {
  const build = (
    provider: any,
    stateId: string | null = 'state-1',
    maxLevel = 3,
  ) => {
    const cache = new Map<string, unknown>();
    const cacheManager: any = {
      get: jest.fn(async (k: string) => cache.get(k)),
      set: jest.fn(async (k: string, v: unknown) => void cache.set(k, v)),
    };
    const stateRepo: any = {
      findOne: jest.fn().mockResolvedValue(stateId ? { id: stateId } : null),
    };
    const config: any = { get: () => maxLevel };
    return new PostcodeService(provider, stateRepo, cacheManager, config);
  };
  const address = {
    street: '1 Allen Ave',
    city: 'Ikeja',
    state: 'Lagos',
    latitude: 6.6,
    longitude: 3.3,
  };

  it('normalizes and rejects malformed codes', () => {
    const service = build({});
    expect(service.normalize(' fc02-a09 db09 ')).toBe('FC02A09DB09');
    expect(() => service.normalize('abc')).toThrow(BadRequestException);
    // 11 characters but wrong shape (state must be letters, LGA digits)
    expect(() => service.normalize('1234567890A')).toThrow(BadRequestException);
  });

  it('searches, verifies at level 1 and pins down at level 3', async () => {
    const provider = {
      ...refs,
      search: jest
        .fn()
        .mockResolvedValue({ found: true, postcode: 'la01a01ab01' }),
      lookup: jest
        .fn()
        .mockResolvedValueOnce({ found: true, record })
        .mockResolvedValueOnce({
          found: true,
          record: { ...record, street: '1 Allen Avenue' },
        }),
    };
    const out = await build(provider).resolve(address);
    expect(out).toMatchObject({
      status: 'verified',
      postcode: 'LA01A01AB01',
      stateId: 'state-1',
    });
    expect((out as any).record.street).toBe('1 Allen Avenue');
    expect(provider.lookup).toHaveBeenNthCalledWith(1, 'LA01A01AB01', 1);
    expect(provider.lookup).toHaveBeenNthCalledWith(2, 'LA01A01AB01', 3);
  });

  it('skips the level 3 lookup when the key only has level 1', async () => {
    const provider = {
      ...refs,
      search: jest.fn(),
      lookup: jest.fn().mockResolvedValue({ found: true, record }),
    };
    const out = await build(provider, 'state-1', 1).resolve({
      ...address,
      postcode: 'LA01A01AB01',
    });
    expect(out.status).toBe('verified');
    expect(provider.lookup).toHaveBeenCalledTimes(1);
  });

  it('skips search when the customer already gave a postcode', async () => {
    const provider = {
      ...refs,
      search: jest.fn(),
      lookup: jest.fn().mockResolvedValue({ found: true, record }),
    };
    await build(provider).resolve({ ...address, postcode: 'LA01A01AB01' });
    expect(provider.search).not.toHaveBeenCalled();
  });

  it('reports a mismatch when the typed state or city disagrees', async () => {
    const provider = {
      ...refs,
      search: jest
        .fn()
        .mockResolvedValue({ found: true, postcode: 'LA01A01AB01' }),
      lookup: jest.fn().mockResolvedValue({ found: true, record }),
    };
    const out = await build(provider).resolve({
      street: 'x',
      city: 'Kano Municipal',
      state: 'Kano',
      latitude: 6.6,
      longitude: 3.3,
    });
    expect(out).toMatchObject({
      status: 'mismatch',
      mismatches: ['state', 'city'],
    });
    expect(provider.lookup).toHaveBeenCalledTimes(1);
  });

  it('derives state and LGA names from the code when level 1 returns only validity', async () => {
    const provider = {
      ...refs,
      search: jest.fn(),
      lookup: jest.fn().mockResolvedValue({
        found: true,
        record: { postcode: 'LA01A01AB01', state: '' },
      }),
    };
    const out: any = await build(provider, 'state-1', 1).resolve({
      street: 'x',
      city: 'Ikeja',
      state: 'Lagos',
      postcode: 'LA01A01AB01',
    });
    expect(out.status).toBe('verified');
    expect(out.record).toMatchObject({ state: 'Lagos', lga: 'Ikeja' });
    const wrong: any = await build(provider, 'state-1', 1).resolve({
      street: 'x',
      city: 'Ikeja',
      state: 'Kano',
      postcode: 'LA01A01AB01',
    });
    expect(wrong).toMatchObject({ status: 'mismatch', mismatches: ['state'] });
  });

  it('cannot find a postcode from address text alone', async () => {
    const provider = { ...refs, search: jest.fn(), lookup: jest.fn() };
    expect(
      await build(provider).resolve({ street: 'x', city: 'y', state: 'z' }),
    ).toEqual({ status: 'unavailable' });
    expect(provider.search).not.toHaveBeenCalled();
  });

  it('reports not_found when search finds nothing', async () => {
    const provider = {
      ...refs,
      search: jest.fn().mockResolvedValue({ found: false }),
      lookup: jest.fn(),
    };
    expect(await build(provider).resolve(address)).toEqual({
      status: 'not_found',
    });
  });

  it('degrades to unavailable instead of throwing on provider failure', async () => {
    const provider = {
      ...refs,
      search: jest.fn().mockRejectedValue(new Error('down')),
      lookup: jest.fn(),
    };
    expect(await build(provider).resolve(address)).toEqual({
      status: 'unavailable',
    });
  });
});

describe('OrderService postcode handling', () => {
  const make = (resolution: any) => {
    const service = Object.create(OrderService.prototype) as any;
    service.postcodeService = {
      normalize: (c: string) => c.toUpperCase(),
      resolve: jest.fn().mockResolvedValue(resolution),
    };
    service.logger = { warn: jest.fn() };
    return service;
  };
  const address = {
    street: '1 Road',
    city: 'Ikeja',
    state: 'Lagos',
    country: 'NG',
  };

  it('strips client-supplied verification fields and skips pickups', async () => {
    const svc = make(null);
    const out = await svc.applyPostcode(
      { ...address, postcodeVerified: true, latitude: 1 },
      true,
    );
    expect(out.address.postcodeVerified).toBeUndefined();
    expect(out.address.latitude).toBeUndefined();
    expect(svc.postcodeService.resolve).not.toHaveBeenCalled();
  });

  it('uses NIPOST data when verified', async () => {
    const out = await make({
      status: 'verified',
      postcode: 'LA01A01AB01',
      stateId: 'state-9',
      record,
    }).applyPostcode(address, false);
    expect(out.address).toMatchObject({
      postcode: 'LA01A01AB01',
      postcodeVerified: true,
      stateId: 'state-9',
      lga: 'Ikeja',
      latitude: 6.6,
    });
    expect(out.mismatch).toBeUndefined();
  });

  it('keeps the typed address and flags a mismatch for support', async () => {
    const out = await make({
      status: 'mismatch',
      postcode: 'LA01A01AB01',
      record,
      mismatches: ['city'],
    }).applyPostcode(address, false);
    expect(out.address).toMatchObject({
      city: 'Ikeja',
      postcodeVerified: false,
      postcodeMismatch: ['city'],
    });
    expect(out.mismatch).toEqual({ postcode: 'LA01A01AB01', fields: ['city'] });
  });

  it('never blocks the order when NIPOST is unavailable', async () => {
    const out = await make({ status: 'unavailable' }).applyPostcode(
      address,
      false,
    );
    expect(out.address).toMatchObject({
      postcodeVerified: false,
      state: 'Lagos',
    });
    expect(out.mismatch).toBeUndefined();
  });

  it('saves the postcode on the profile and opens a support ticket on mismatch', async () => {
    const svc = make(null);
    const update = jest.fn();
    svc.dataSource = { getRepository: () => ({ update }) };
    svc.complaintsService = { create: jest.fn() };
    const order = {
      id: 'o1',
      code: 'ORD-1',
      address: { postcode: 'LA01A01AB01', postcodeVerified: true },
    };
    await svc.recordPostcodeOutcome({ id: 'u1' }, order);
    expect(update).toHaveBeenCalledWith('u1', { postcode: 'LA01A01AB01' });
    await svc.recordPostcodeOutcome({ id: 'u1' }, order, {
      postcode: 'LA01A01AB01',
      fields: ['state'],
    });
    expect(svc.complaintsService.create).toHaveBeenCalledWith(
      { id: 'u1' },
      expect.objectContaining({ orderId: 'o1' }),
    );
  });
});

import { NipostPostcodeProvider } from './nipost-postcode.provider';
import { of } from 'rxjs';

describe('NipostPostcodeProvider', () => {
  const make = (body: unknown) => {
    const get = jest.fn().mockReturnValue(of({ data: body }));
    const config: any = {
      get: (k: string) =>
        k === 'NIPOST_POSTCODE_URL'
          ? 'https://api.example.test/v1/'
          : 'test-key',
    };
    return {
      provider: new NipostPostcodeProvider(config, { get } as any),
      get,
    };
  };

  it('calls /lookup?code= with the X-API-Key header', async () => {
    const { provider, get } = make({
      data: { postcode: 'X', valid: false, status: 'not_found' },
    });
    await provider.lookup('LA03A58BU18', 1);
    expect(get).toHaveBeenCalledWith(
      'https://api.example.test/v1/lookup',
      expect.objectContaining({
        headers: { 'X-API-Key': 'test-key' },
        params: { code: 'LA03A58BU18', level: 1 },
      }),
    );
  });

  it('reverse geocodes coordinates via /search/reverse', async () => {
    const { provider, get } = make({
      data: { found: true, unit: { postcode: 'EK-01-A03-FK-01' } },
    });
    expect(await provider.search({ latitude: 7.6, longitude: 5.2 })).toEqual({
      found: true,
      postcode: 'EK-01-A03-FK-01',
    });
    expect(get).toHaveBeenCalledWith(
      'https://api.example.test/v1/search/reverse',
      expect.objectContaining({ params: { lat: 7.6, lng: 5.2 } }),
    );
  });

  it('maps status not_found and invalid to found:false', async () => {
    for (const status of ['not_found', 'invalid']) {
      const { provider } = make({ data: { valid: false, status } });
      expect(await provider.lookup('LA03A58BU18', 1)).toEqual({ found: false });
    }
  });

  it('maps the documented Autofill response, with a compact postcode', async () => {
    const { provider } = make({
      data: {
        postcode: 'EK-01-A03-FK-01',
        valid: true,
        administrative_address: {
          state_name: 'EKITI',
          lga_name: 'ADO EKITI',
          locality_name: 'ADO EKITI',
          zone: 'SOUTH WEST',
        },
        recent_house_address: {
          recent: 'NTA ROAD, BACK OF FABIAN HOTEL, ADO EKITI',
        },
        building_use_status: 'residential',
      },
    });
    expect(await provider.lookup('EK01A03FK01', 2)).toEqual({
      found: true,
      record: {
        postcode: 'EK01A03FK01',
        state: 'EKITI',
        lga: 'ADO EKITI',
        area: 'ADO EKITI',
        street: 'NTA ROAD, BACK OF FABIAN HOTEL, ADO EKITI',
        zone: 'SOUTH WEST',
        buildingUse: 'residential',
      },
    });
  });

  it('maps a valid response to a record', async () => {
    const { provider } = make({
      data: {
        postcode: 'LA-03-A58-BU-18',
        valid: true,
        administrative_address: {
          state_name: 'LAGOS',
          lga_name: 'IKEJA',
          locality_name: 'ALLEN',
        },
        recent_house_address: { recent: '1 ALLEN AVENUE' },
      },
    });
    expect(await provider.lookup('LA03A58BU18', 1)).toMatchObject({
      found: true,
      record: {
        state: 'LAGOS',
        lga: 'IKEJA',
        area: 'ALLEN',
        street: '1 ALLEN AVENUE',
      },
    });
  });
});
