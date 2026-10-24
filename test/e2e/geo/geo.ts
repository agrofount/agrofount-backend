import { DataSource } from 'typeorm';
import { CountryEntity } from '../../../src/country/entities/country.entity';
import { StateEntity } from '../../../src/state/entities/state.entity';
import { CityEntity } from '../../../src/city/entities/city.entity';

/** Permission sets for admins that are not superadmin. */
export const perms = (resource: string, ...actions: string[]) => [
  { resource, actions },
];

export async function seedCountry(
  dataSource: DataSource,
  overrides: Partial<CountryEntity> = {},
) {
  const repo = dataSource.getRepository(CountryEntity);
  const n = Math.random().toString(36).slice(2, 8);
  return repo.save(
    repo.create({
      name: `Country ${n}`,
      code: `C${n}`,
      isActive: true,
      ...overrides,
    }),
  );
}

export async function seedState(
  dataSource: DataSource,
  country: CountryEntity,
  overrides: Partial<StateEntity> = {},
) {
  const repo = dataSource.getRepository(StateEntity);
  const n = Math.random().toString(36).slice(2, 8);
  return repo.save(
    repo.create({
      name: `State ${n}`,
      code: `S${n}`,
      isActive: true,
      country,
      ...overrides,
    }),
  );
}

export async function seedCity(
  dataSource: DataSource,
  state: StateEntity,
  overrides: Partial<CityEntity> = {},
) {
  const repo = dataSource.getRepository(CityEntity);
  const n = Math.random().toString(36).slice(2, 8);
  return repo.save(
    repo.create({
      name: `City ${n}`,
      code: `Y${n}`,
      isActive: true,
      state,
      ...overrides,
    }),
  );
}

export const MISSING_UUID = '00000000-0000-4000-8000-000000000000';
