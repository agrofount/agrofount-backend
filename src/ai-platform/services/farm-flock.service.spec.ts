import { FarmFlockService } from './farm-flock.service';
import { FarmFlockStatus } from '../entities/farm-flock.entity';

describe('FarmFlockService', () => {
  const NOW = new Date('2026-07-04T00:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function setup() {
    const flocks: any[] = [];
    const flockRepository = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        const saved = { id: value.id || `flock-${flocks.length + 1}`, ...value };
        const index = flocks.findIndex((item) => item.id === saved.id);
        if (index >= 0) flocks[index] = saved;
        else flocks.push(saved);
        return saved;
      }),
      findOne: jest.fn(async ({ where }: any) =>
        flocks.find(
          (item) => item.userId === where.userId && item.status === where.status,
        ) || null,
      ),
      find: jest.fn(async () => flocks),
    };
    const service = new FarmFlockService(flockRepository as any);
    return { service, flocks, flockRepository };
  }

  describe('computeVaccinationStatus', () => {
    it('returns empty buckets when there is no flock', () => {
      const { service } = setup();
      expect(service.computeVaccinationStatus(null)).toEqual({
        flock: null,
        dueToday: [],
        upcoming7Days: [],
        missed: [],
      });
    });

    it('flags a vaccine as due today when the flock is exactly at the target day', () => {
      const { service } = setup();
      const flock = {
        birdType: 'Broiler',
        quantity: 500,
        startDate: '2026-06-27', // 7 days before NOW
        status: FarmFlockStatus.Active,
      } as any;

      const status = service.computeVaccinationStatus(flock);

      expect(status.dueToday.map((i) => i.vaccineName)).toContain(
        'Newcastle Disease (Lasota) - Dose 1',
      );
      expect(status.upcoming7Days.map((i) => i.vaccineName)).toContain(
        'Gumboro (IBD) - Dose 1',
      );
      expect(status.missed).toEqual([]);
    });

    it('flags a vaccine as missed once its window has passed', () => {
      const { service } = setup();
      const flock = {
        birdType: 'Broiler',
        quantity: 500,
        startDate: '2026-06-14', // 20 days before NOW
        status: FarmFlockStatus.Active,
      } as any;

      const status = service.computeVaccinationStatus(flock);

      expect(status.missed.map((i) => i.vaccineName)).toEqual(
        expect.arrayContaining([
          'Newcastle Disease (Lasota) - Dose 1',
          'Gumboro (IBD) - Dose 1',
        ]),
      );
      expect(status.upcoming7Days.map((i) => i.vaccineName)).toContain(
        'Newcastle Disease (Lasota) - Dose 2',
      );
    });
  });

  describe('upsertFromChatContext', () => {
    it('does nothing when required fields are missing', async () => {
      const { service, flocks } = setup();
      const result = await service.upsertFromChatContext('user-1', {
        birdType: 'Broiler',
      });
      expect(result).toBeNull();
      expect(flocks).toHaveLength(0);
    });

    it('creates a new active flock from complete chat context', async () => {
      const { service, flocks } = setup();
      const result = await service.upsertFromChatContext('user-1', {
        birdType: 'Broiler',
        quantity: 500,
        birdAgeWeeks: 2,
      });

      expect(result).toEqual(
        expect.objectContaining({
          userId: 'user-1',
          birdType: 'Broiler',
          quantity: 500,
          status: FarmFlockStatus.Active,
        }),
      );
      expect(flocks).toHaveLength(1);
    });

    it('updates the existing active flock instead of creating a duplicate', async () => {
      const { service, flocks } = setup();
      await service.upsertFromChatContext('user-1', {
        birdType: 'Broiler',
        quantity: 500,
        birdAgeWeeks: 2,
      });
      await service.upsertFromChatContext('user-1', {
        birdType: 'Broiler',
        quantity: 480,
        birdAgeWeeks: 3,
      });

      expect(flocks).toHaveLength(1);
      expect(flocks[0].quantity).toBe(480);
    });
  });
});
