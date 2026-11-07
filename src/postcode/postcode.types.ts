export interface PostcodeRecord {
  postcode: string;
  state: string;
  lga?: string;
  area?: string;
  city?: string;
  street?: string;
  /** Not provided by NIPOST; only the development mock fills it. */
  landmark?: string;
  zone?: string;
  buildingUse?: string;
  latitude?: number;
  longitude?: number;
}

export interface AddressQuery {
  street?: string;
  city?: string;
  state?: string;
  landmark?: string;
  /** NIPOST cannot search by address text; it can resolve coordinates. */
  latitude?: number;
  longitude?: number;
}

export interface NamedCode {
  code: string;
  name: string;
}

/** Level 1: state, LGA, area. Levels 2 to 3: district, street, building. */
export type LookupLevel = 1 | 2 | 3;

export type PostcodeLookupResult =
  | { status: 'verified'; record: PostcodeRecord; stateId?: string }
  | { status: 'not_found' }
  | { status: 'unavailable' };

export type PostcodeResolution =
  | {
      status: 'verified';
      postcode: string;
      record: PostcodeRecord;
      stateId?: string;
    }
  | {
      status: 'mismatch';
      postcode: string;
      record: PostcodeRecord;
      stateId?: string;
      mismatches: string[];
    }
  | { status: 'not_found' }
  | { status: 'unavailable' };

/** Raw access to whichever service backs the postcode data. */
export abstract class PostcodeProvider {
  /** True only for the development mock, which can search by address text. */
  readonly supportsAddressSearch?: boolean;

  /**
   * NIPOST reverse geocode: the nearest postcode to a coordinate. NIPOST has
   * no free-text address search, so this needs latitude and longitude.
   */
  abstract search(
    query: AddressQuery,
  ): Promise<{ found: true; postcode: string } | { found: false }>;

  /** Free reference data: state codes and names. */
  abstract states(): Promise<NamedCode[]>;

  /** Free reference data: LGA codes and names within a state. */
  abstract lgas(stateCode: string): Promise<NamedCode[]>;

  /** NIPOST Lookup at the given level of detail. */
  abstract lookup(
    postcode: string,
    level: LookupLevel,
  ): Promise<{ found: true; record: PostcodeRecord } | { found: false }>;
}
