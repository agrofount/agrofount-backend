import { Injectable } from '@nestjs/common';
import {
  AddressQuery,
  NamedCode,
  PostcodeProvider,
  PostcodeRecord,
} from './postcode.types';

/** Magic codes for exercising each resolve outcome. All match the real format. */
export const MOCK_POSTCODE_NOT_FOUND = 'ZZ00A00ZZ00';
export const MOCK_POSTCODE_UNAVAILABLE = 'ZZ99A99ZZ99';
export const MOCK_POSTCODE_MISMATCH = 'ZZ11A11ZZ11';

const LAGOS: PostcodeRecord = {
  postcode: 'LA01A01AB01',
  state: 'Lagos',
  lga: 'Ikeja',
  area: 'Allen',
  city: 'Ikeja',
  street: '1 Allen Avenue',
  landmark: 'Near Allen Roundabout',
  latitude: 6.6018,
  longitude: 3.3515,
};

const ABUJA: PostcodeRecord = {
  postcode: 'FC02A09DB09',
  state: 'FCT',
  lga: 'Municipal Area Council',
  area: 'Garki',
  city: 'Abuja',
  street: '12 Moshood Abiola Way',
  landmark: 'Opposite Garki Market',
  latitude: 9.0344,
  longitude: 7.4898,
};

const EKITI: PostcodeRecord = {
  postcode: 'EK01A03FK01',
  state: 'EKITI',
  lga: 'ADO EKITI',
  area: 'ADO EKITI',
  city: 'ADO EKITI',
  street: 'NTA ROAD, BACK OF FABIAN HOTEL, ADO EKITI',
  landmark: 'Back of Fabian Hotel',
  zone: 'SOUTH WEST',
  buildingUse: 'residential',
};

const OYO: PostcodeRecord = {
  postcode: 'OY03A05OL01',
  state: 'Oyo',
  lga: 'Oluyole',
  area: 'Oluyole',
  city: 'Ibadan',
  street: 'Oluyole Industrial Estate, Ibadan',
  landmark: 'Oluyole Industrial Estate',
  latitude: 7.332,
  longitude: 3.868,
};

/** True when the mock provider is explicitly switched on. */
export const isPostcodeMockEnabled = (): boolean =>
  String(process.env.NIPOST_POSTCODE_MOCK ?? '').toLowerCase() === 'true';

/** Sample dispatch centre for product pages when mock mode is enabled. */
export const mockSourcingLocation = () => ({
  name: 'Oluyole Dispatch Centre',
  address: OYO.street,
  postcode: OYO.postcode,
  postcodeVerified: true,
  latitude: OYO.latitude,
  longitude: OYO.longitude,
  state: OYO.state,
  lga: OYO.lga,
  country: 'Nigeria',
});

const KNOWN: Record<string, PostcodeRecord> = {
  [OYO.postcode]: OYO,
  [EKITI.postcode]: EKITI,
  [LAGOS.postcode]: LAGOS,
  [ABUJA.postcode]: ABUJA,
};

const PREFIX_RECORDS: Record<string, PostcodeRecord> = {
  LA: LAGOS,
  FC: ABUJA,
  EK: EKITI,
  OY: OYO,
};

const MAX_REMEMBERED = 200;

const fold = (value?: string): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

/**
 * Deterministic stand-in for NIPOST, enabled by NIPOST_POSTCODE_MOCK=true. It
 * never makes a network call. PostcodeService still does normalisation, state
 * matching, mismatch comparison and caching on top of it.
 */
@Injectable()
export class MockPostcodeProvider extends PostcodeProvider {
  /** Records made up from a typed address, so a later lookup echoes them. */
  private readonly remembered = new Map<string, PostcodeRecord>();

  /** Lets the service search by address text, which NIPOST itself cannot. */
  readonly supportsAddressSearch = true;

  async search(query: AddressQuery) {
    const state = fold(query.state);
    if (!state && (query.latitude == null || query.longitude == null)) {
      return { found: false as const };
    }
    if (!state || state === 'lagos') return this.found(LAGOS);
    if (['abuja', 'fct', 'federalcapitalterritory'].includes(state)) {
      return this.found(ABUJA);
    }
    if (state === 'ekiti') return this.found(EKITI);
    if (state === 'oyo') return this.found(OYO);
    const prefix = state.slice(0, 2).toUpperCase();
    if (prefix.length < 2) return { found: false as const };
    const postcode = `${prefix}01A01AB01`;
    const record: PostcodeRecord = {
      postcode,
      state: query.state!.trim(),
      lga: query.city?.trim() || undefined,
      area: query.city?.trim() || undefined,
      city: query.city?.trim() || undefined,
      street: query.street?.trim() || undefined,
    };
    this.remember(record);
    return this.found(record);
  }

  async states(): Promise<NamedCode[]> {
    return [
      { code: 'LA', name: 'Lagos' },
      { code: 'FC', name: 'FCT' },
    ];
  }

  async lgas(stateCode: string): Promise<NamedCode[]> {
    if (stateCode === 'LA') return [{ code: '01', name: 'Ikeja' }];
    if (stateCode === 'FC')
      return [{ code: '02', name: 'Municipal Area Council' }];
    return [];
  }

  async lookup(postcode: string) {
    // Every level returns the same record, which already carries street detail.
    if (postcode === MOCK_POSTCODE_NOT_FOUND) return { found: false as const };
    if (postcode === MOCK_POSTCODE_UNAVAILABLE) {
      throw new Error('Mock NIPOST outage');
    }
    if (postcode === MOCK_POSTCODE_MISMATCH) {
      return { found: true as const, record: { ...LAGOS, postcode } };
    }
    const record = KNOWN[postcode] ?? this.remembered.get(postcode);
    if (record) return { found: true as const, record: { ...record } };
    // Valid-looking but never seen: reuse the record of that state so every
    // autofill field has a realistic value. Unknown prefixes get neutral
    // values and no state, so they cannot mismatch.
    const base = PREFIX_RECORDS[postcode.slice(0, 2)];
    if (base) return { found: true as const, record: { ...base, postcode } };
    const district = postcode.slice(4, 7);
    return {
      found: true as const,
      record: {
        postcode,
        state: '',
        lga: `LGA ${postcode.slice(2, 4)}`,
        area: `District ${district}`,
        city: `District ${district}`,
        street: `${district} Layout Road`,
        landmark: `Near ${district} Junction`,
        buildingUse: 'residential',
      },
    };
  }

  private found(record: PostcodeRecord) {
    return { found: true as const, postcode: record.postcode };
  }

  private remember(record: PostcodeRecord) {
    if (this.remembered.size >= MAX_REMEMBERED) {
      const oldest = this.remembered.keys().next().value;
      if (oldest) this.remembered.delete(oldest);
    }
    this.remembered.set(record.postcode, record);
  }
}
