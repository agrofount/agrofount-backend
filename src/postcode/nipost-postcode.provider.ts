import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import {
  AddressQuery,
  LookupLevel,
  NamedCode,
  PostcodeProvider,
  PostcodeRecord,
} from './postcode.types';

/**
 * NIPOST National Digital Postcode API client.
 *
 * Contract (docs.postcode.gov.ng): auth is the X-API-Key header. Lookup is
 * GET {base}/lookup?code=&level= answering HTTP 200 with
 * { data: { postcode, valid, ... } }. Reverse geocode is GET /search/reverse,
 * reference data is GET /reference/states and /reference/lgas?state=.
 * A key only works up to its granted level (403 level_not_granted beyond it),
 * and a test key resolves only the sandbox dataset.
 * Config: NIPOST_POSTCODE_URL, NIPOST_POSTCODE_API_KEY.
 */
@Injectable()
export class NipostPostcodeProvider extends PostcodeProvider {
  private readonly logger = new Logger(NipostPostcodeProvider.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    super();
  }

  private config() {
    const baseUrl = this.configService.get<string>('NIPOST_POSTCODE_URL');
    const apiKey = this.configService.get<string>('NIPOST_POSTCODE_API_KEY');
    if (!baseUrl || !apiKey) {
      throw new Error('NIPOST postcode API is not configured');
    }
    return {
      baseUrl: baseUrl.replace(/\/$/, ''),
      headers: { 'X-API-Key': apiKey },
    };
  }

  async search(query: AddressQuery) {
    if (query.latitude == null || query.longitude == null) {
      // NIPOST has no free-text address search (only autocomplete on a partial
      // postcode, nearby and reverse geocode by coordinate).
      throw new Error('Coordinates are required to find a postcode');
    }
    const { baseUrl, headers } = this.config();
    try {
      const response = await lastValueFrom(
        this.httpService.get(`${baseUrl}/search/reverse`, {
          headers,
          params: { lat: query.latitude, lng: query.longitude },
          timeout: 5_000,
        }),
      );
      const data = response.data?.data ?? response.data;
      const postcode = data?.found ? data?.unit?.postcode : undefined;
      return postcode
        ? { found: true as const, postcode: String(postcode) }
        : { found: false as const };
    } catch (error) {
      this.logger.warn(
        `NIPOST reverse geocode failed: ${error?.message || error}`,
      );
      throw error;
    }
  }

  async states(): Promise<NamedCode[]> {
    return this.reference('reference/states', undefined, 'states');
  }

  async lgas(stateCode: string): Promise<NamedCode[]> {
    return this.reference('reference/lgas', { state: stateCode }, 'lgas');
  }

  private async reference(
    path: string,
    params: Record<string, string> | undefined,
    key: 'states' | 'lgas',
  ): Promise<NamedCode[]> {
    const { baseUrl, headers } = this.config();
    const response = await lastValueFrom(
      this.httpService.get(`${baseUrl}/${path}`, {
        headers,
        params,
        timeout: 5_000,
      }),
    );
    const list = (response.data?.data ?? response.data)?.[key];
    return Array.isArray(list)
      ? list.map((item: any) => ({
          code: String(item.code),
          name: String(item.name ?? ''),
        }))
      : [];
  }

  async lookup(postcode: string, level: LookupLevel) {
    const { baseUrl, headers } = this.config();
    try {
      const response = await lastValueFrom(
        this.httpService.get(`${baseUrl}/lookup`, {
          headers,
          params: { code: postcode, level },
          timeout: 5_000,
        }),
      );
      // NIPOST answers HTTP 200 for every lookup and reports the outcome in
      // data.status ("not_found", "invalid", ...), so a 404 is a wrong route.
      const data = response.data?.data ?? response.data;
      if (!(data?.valid === true || data?.verified === true)) {
        return { found: false as const };
      }
      return { found: true as const, record: this.mapRecord(postcode, data) };
    } catch (error) {
      this.logger.warn(`NIPOST lookup failed: ${error?.message || error}`);
      throw error;
    }
  }

  /**
   * Level 1 (Postcode Validator) only says the code is valid. Postcode
   * Autofill adds administrative_address, recent_house_address and
   * building_use_status. State and LGA are otherwise derived from the code.
   */
  private mapRecord(postcode: string, data: any): PostcodeRecord {
    const admin = data?.administrative_address ?? {};
    return {
      // Always the compact form (EK01A03FK01), never the dashed display form.
      postcode,
      state: String(admin.state_name ?? ''),
      lga: admin.lga_name,
      area: admin.locality_name,
      street: data?.recent_house_address?.recent,
      zone: admin.zone,
      buildingUse: data?.building_use_status,
    };
  }
}
