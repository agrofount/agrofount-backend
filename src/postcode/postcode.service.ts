import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { ILike, Repository } from 'typeorm';
import { StateEntity } from '../state/entities/state.entity';
import {
  AddressQuery,
  LookupLevel,
  PostcodeLookupResult,
  PostcodeProvider,
  PostcodeRecord,
  PostcodeResolution,
} from './postcode.types';

// AA 99 H77 BB 55: state, LGA, district, area, unit.
const POSTCODE_PATTERN = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{3}[A-Z]{2}[0-9]{2}$/;
const REFERENCE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// NIPOST says FCT, our state list says Federal Capital Territory, and people
// type Abuja. They are one state.
const FCT_NAMES = ['fct', 'abuja', 'federalcapitalterritory'];

const fold = (value?: string | null): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/\b(state|local government area|lga)\b/g, '')
    .replace(/[^a-z0-9]/g, '');

const foldState = (value?: string | null): string => {
  const folded = fold(value);
  return FCT_NAMES.includes(folded) ? 'fct' : folded;
};

@Injectable()
export class PostcodeService {
  private readonly logger = new Logger(PostcodeService.name);

  constructor(
    private readonly provider: PostcodeProvider,
    @InjectRepository(StateEntity)
    private readonly stateRepository: Repository<StateEntity>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly configService: ConfigService,
  ) {}

  /** Strips spaces/dashes and uppercases. Throws 400 on a malformed code. */
  normalize(input: string): string {
    const code = String(input ?? '')
      .replace(/[\s-]/g, '')
      .toUpperCase();
    if (!POSTCODE_PATTERN.test(code)) {
      throw new BadRequestException(
        'Postcode must look like FC-02-A09-DB-09 (state, LGA, district, area, unit)',
      );
    }
    return code;
  }

  /**
   * Step 2 to 4 of the checkout flow. Finds the postcode (unless the customer
   * already gave one), confirms state, LGA and area (Lookup Level 1), then
   * pins down the exact place (Levels 2 to 3). Never throws for provider
   * problems: an outage or unknown address must not block a sale.
   */
  async resolve(
    address: AddressQuery & { postcode?: string },
  ): Promise<PostcodeResolution> {
    let postcode: string;
    if (address.postcode) {
      postcode = this.normalize(address.postcode);
    } else {
      const found = await this.search(address);
      if (found.status !== 'found') return { status: found.status };
      postcode = found.postcode;
    }

    const basic = await this.lookup(postcode, 1);
    if (basic.status !== 'verified') return { status: basic.status };

    const mismatches = this.compare(address, basic.record);
    if (mismatches.length) {
      return {
        status: 'mismatch',
        postcode,
        record: basic.record,
        stateId: basic.stateId,
        mismatches,
      };
    }

    // Levels 2 and above add the administrative and recent house address. The
    // key may only be granted level 1 (NIPOST_POSTCODE_MAX_LEVEL, default 1),
    // so ask for the highest level it has, up to 3.
    const maxLevel = Math.min(
      3,
      Number(this.configService.get('NIPOST_POSTCODE_MAX_LEVEL') ?? 1),
    );
    if (maxLevel < 2) {
      return {
        status: 'verified',
        postcode,
        record: basic.record,
        stateId: basic.stateId,
      };
    }
    const detail = await this.lookup(postcode, maxLevel as LookupLevel);
    const record: PostcodeRecord =
      detail.status === 'verified'
        ? { ...basic.record, ...this.definedOnly(detail.record) }
        : basic.record;
    return { status: 'verified', postcode, record, stateId: basic.stateId };
  }

  async search(
    query: AddressQuery,
  ): Promise<
    | { status: 'found'; postcode: string }
    | { status: 'not_found' }
    | { status: 'unavailable' }
  > {
    // NIPOST cannot turn address text into a postcode, only coordinates.
    if (this.provider.supportsAddressSearch) {
      // Development mock: deterministic, so no cache and no coordinates needed.
      try {
        const result = await this.provider.search(query);
        return result.found
          ? { status: 'found', postcode: this.normalize(result.postcode) }
          : { status: 'not_found' };
      } catch {
        return { status: 'unavailable' };
      }
    }
    if (query.latitude == null || query.longitude == null) {
      return { status: 'unavailable' };
    }
    const cacheKey = `postcode:search:${query.latitude.toFixed(
      5,
    )}:${query.longitude.toFixed(5)}`;
    const cached = await this.cacheManager
      .get<{ postcode: string } | 'none'>(cacheKey)
      .catch(() => undefined);
    if (cached === 'none') return { status: 'not_found' };
    if (cached) return { status: 'found', postcode: cached.postcode };

    try {
      const result = await this.provider.search(query);
      if (!result.found) {
        await this.cacheManager
          .set(cacheKey, 'none', CACHE_TTL_MS)
          .catch(() => undefined);
        return { status: 'not_found' };
      }
      const postcode = this.normalize(result.postcode);
      await this.cacheManager
        .set(cacheKey, { postcode }, CACHE_TTL_MS)
        .catch(() => undefined);
      return { status: 'found', postcode };
    } catch (error) {
      this.logger.warn(`Postcode search unavailable: ${error?.message}`);
      return { status: 'unavailable' };
    }
  }

  async lookup(
    input: string,
    level: LookupLevel = 1,
  ): Promise<PostcodeLookupResult> {
    const postcode = this.normalize(input);
    const cacheKey = `postcode:${level}:${postcode}`;
    const cached = await this.cacheManager
      .get<PostcodeLookupResult>(cacheKey)
      .catch(() => undefined);
    if (cached) return cached;

    let result: PostcodeLookupResult;
    try {
      const found = await this.provider.lookup(postcode, level);
      if (!found.found) {
        result = { status: 'not_found' };
      } else {
        found.record = await this.withCodeNames(postcode, found.record);
        const stateName = found.record.state?.trim();
        const state = stateName
          ? await this.stateRepository.findOne({
              where: {
                name: ILike(
                  FCT_NAMES.includes(fold(stateName))
                    ? 'Federal Capital Territory'
                    : stateName,
                ),
              },
            })
          : null;
        // Use our own spelling so the checkout state select can match it.
        if (state?.name) found.record.state = state.name;
        result = {
          status: 'verified',
          record: found.record,
          stateId: state?.id,
        };
      }
    } catch (error) {
      this.logger.warn(`Postcode ${postcode} unavailable: ${error?.message}`);
      return { status: 'unavailable' };
    }
    await this.cacheManager
      .set(cacheKey, result, CACHE_TTL_MS)
      .catch(() => undefined);
    return result;
  }

  /**
   * Level 1 returns validity only, so state and LGA names come from the code
   * itself via NIPOST's free reference data. District and area have no names.
   */
  private async withCodeNames(
    postcode: string,
    record: PostcodeRecord,
  ): Promise<PostcodeRecord> {
    if (record.state && record.lga) return record;
    const match = /^([A-Z]{2})([0-9]{2})/.exec(postcode);
    if (!match) return record;
    const [, stateCode, lgaCode] = match;
    try {
      const states = await this.cachedReference('postcode:ref:states', () =>
        this.provider.states(),
      );
      const lgas = await this.cachedReference(
        `postcode:ref:lgas:${stateCode}`,
        () => this.provider.lgas(stateCode),
      );
      return {
        ...record,
        state:
          record.state || states.find((s) => s.code === stateCode)?.name || '',
        lga: record.lga || lgas.find((l) => l.code === lgaCode)?.name,
      };
    } catch (error) {
      this.logger.warn(
        `Postcode reference data unavailable: ${error?.message}`,
      );
      return record;
    }
  }

  private async cachedReference<T>(
    key: string,
    load: () => Promise<T[]>,
  ): Promise<T[]> {
    const cached = await this.cacheManager.get<T[]>(key).catch(() => undefined);
    if (cached) return cached;
    const value = await load();
    if (value.length) {
      await this.cacheManager
        .set(key, value, REFERENCE_TTL_MS)
        .catch(() => undefined);
    }
    return value;
  }

  /** Names of the typed fields that disagree with what NIPOST says. */
  private compare(typed: AddressQuery, record: PostcodeRecord): string[] {
    const mismatches: string[] = [];
    const state = foldState(typed.state);
    if (state && record.state && state !== foldState(record.state)) {
      mismatches.push('state');
    }
    const city = fold(typed.city);
    const places = [record.lga, record.area, record.city]
      .map(fold)
      .filter(Boolean);
    if (
      city &&
      places.length &&
      !places.some((place) => place.includes(city) || city.includes(place))
    ) {
      mismatches.push('city');
    }
    return mismatches;
  }

  private definedOnly<T extends object>(value: T): Partial<T> {
    return Object.fromEntries(
      Object.entries(value).filter(([, v]) => v !== undefined && v !== ''),
    ) as Partial<T>;
  }
}
