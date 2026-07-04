import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  FarmFlockEntity,
  FarmFlockStatus,
} from '../entities/farm-flock.entity';
import { POULTRY_VACCINATION_SCHEDULE } from '../constants/poultry-vaccination-schedule.constant';

export type VaccinationScheduleItem = {
  vaccineName: string;
  method: string;
  targetDay: number;
};

export type VaccinationStatus = {
  flock: { birdType: string; quantity: number; startDate: string } | null;
  dueToday: VaccinationScheduleItem[];
  upcoming7Days: VaccinationScheduleItem[];
  missed: VaccinationScheduleItem[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const UPCOMING_WINDOW_DAYS = 7;

@Injectable()
export class FarmFlockService {
  constructor(
    @InjectRepository(FarmFlockEntity)
    private readonly flockRepository: Repository<FarmFlockEntity>,
  ) {}

  async upsertFromChatContext(
    userId: string,
    params: { birdType?: unknown; quantity?: unknown; birdAgeWeeks?: unknown },
  ): Promise<FarmFlockEntity | null> {
    const birdType =
      typeof params.birdType === 'string' ? params.birdType.trim() : '';
    const quantity = Number(params.quantity);
    const birdAgeWeeks = Number(params.birdAgeWeeks);

    if (
      !birdType ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(birdAgeWeeks) ||
      birdAgeWeeks < 0
    ) {
      return null;
    }

    const startDate = this.formatDate(
      new Date(Date.now() - birdAgeWeeks * 7 * DAY_MS),
    );

    const existing = await this.getActiveFlock(userId);
    if (existing) {
      existing.birdType = birdType;
      existing.quantity = quantity;
      existing.startDate = startDate;
      return this.flockRepository.save(existing);
    }

    return this.flockRepository.save(
      this.flockRepository.create({
        userId,
        birdType,
        quantity,
        startDate,
        status: FarmFlockStatus.Active,
      }),
    );
  }

  getActiveFlock(userId: string): Promise<FarmFlockEntity | null> {
    return this.flockRepository.findOne({
      where: { userId, status: FarmFlockStatus.Active },
    });
  }

  computeVaccinationStatus(flock: FarmFlockEntity | null): VaccinationStatus {
    if (!flock) {
      return { flock: null, dueToday: [], upcoming7Days: [], missed: [] };
    }

    const ageInDays = Math.floor(
      (Date.now() - new Date(flock.startDate).getTime()) / DAY_MS,
    );

    const dueToday: VaccinationScheduleItem[] = [];
    const upcoming7Days: VaccinationScheduleItem[] = [];
    const missed: VaccinationScheduleItem[] = [];

    for (const entry of POULTRY_VACCINATION_SCHEDULE) {
      const item: VaccinationScheduleItem = {
        vaccineName: entry.vaccineName,
        method: entry.method,
        targetDay: entry.targetDay,
      };
      const diff = ageInDays - entry.targetDay;

      if (diff < -UPCOMING_WINDOW_DAYS) {
        continue;
      } else if (diff < 0) {
        upcoming7Days.push(item);
      } else if (diff <= entry.windowDays) {
        dueToday.push(item);
      } else {
        missed.push(item);
      }
    }

    return {
      flock: {
        birdType: flock.birdType,
        quantity: flock.quantity,
        startDate: flock.startDate,
      },
      dueToday,
      upcoming7Days,
      missed,
    };
  }

  async listActiveFlocksWithDueVaccinesToday(): Promise<FarmFlockEntity[]> {
    const activeFlocks = await this.flockRepository.find({
      where: { status: FarmFlockStatus.Active },
    });
    return activeFlocks.filter(
      (flock) => this.computeVaccinationStatus(flock).dueToday.length > 0,
    );
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
