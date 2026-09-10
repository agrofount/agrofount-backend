import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import {
  LogisticsPricingEntity,
  LogisticsPricingMode,
} from './entities/logistics-pricing.entity';
import { CreateLogisticsPricingDto } from './dto/create-logistics-pricing.dto';
import { UpdateLogisticsPricingDto } from './dto/update-logistics-pricing.dto';
import { StateService } from '../state/state.service';
import { StateEntity } from '../state/entities/state.entity';
import { ProductLocationEntity } from '../product-location/entities/product-location.entity';

type CartData = Record<string, Record<string, any>>;

export type LogisticsFeeLine = {
  productLocationId: string;
  productName?: string;
  category?: string;
  subCategory?: string;
  unit: string;
  quantity: number;
  pricingId: string;
  pricingMode: LogisticsPricingMode;
  price: number;
  cartonSize?: number;
  chargedUnits: number;
  amount: number;
};

@Injectable()
export class LogisticsPricingService {
  private readonly defaultCartonSize = 50;
  private readonly defaultCartonPrice = 4000;

  constructor(
    @InjectRepository(LogisticsPricingEntity)
    private readonly logisticsPricingRepo: Repository<LogisticsPricingEntity>,
    @InjectRepository(StateEntity)
    private readonly stateRepo: Repository<StateEntity>,
    private readonly stateService: StateService,
  ) {}

  async create(dto: CreateLogisticsPricingDto) {
    const state = await this.stateService.findOne(dto.stateId);
    const entity = this.logisticsPricingRepo.create({
      ...dto,
      state,
      subCategory: dto.subCategory?.trim() || null,
      unit: dto.unit?.trim() || null,
      cartonSize:
        dto.pricingMode === LogisticsPricingMode.PER_CARTON
          ? dto.cartonSize
          : null,
      isActive: dto.isActive ?? true,
    });
    return this.logisticsPricingRepo.save(entity);
  }

  async findAll(filters?: { stateId?: string; isActive?: boolean }) {
    return this.logisticsPricingRepo.find({
      where: {
        ...(filters?.stateId ? { state: { id: filters.stateId } } : {}),
        ...(filters?.isActive === undefined
          ? {}
          : { isActive: filters.isActive }),
      },
      order: {
        state: { name: 'ASC' },
        primaryCategory: 'ASC',
        category: 'ASC',
        subCategory: 'ASC',
        unit: 'ASC',
      },
    });
  }

  async findOne(id: string) {
    const pricing = await this.logisticsPricingRepo.findOne({ where: { id } });
    if (!pricing) {
      throw new NotFoundException('Logistics pricing not found');
    }
    return pricing;
  }

  async update(id: string, dto: UpdateLogisticsPricingDto) {
    const pricing = await this.findOne(id);
    const state = dto.stateId
      ? await this.stateService.findOne(dto.stateId)
      : pricing.state;
    Object.assign(pricing, {
      ...dto,
      state,
      subCategory:
        dto.subCategory === undefined
          ? pricing.subCategory
          : dto.subCategory?.trim() || null,
      unit: dto.unit === undefined ? pricing.unit : dto.unit?.trim() || null,
      cartonSize:
        dto.pricingMode === LogisticsPricingMode.PER_CARTON ||
        (!dto.pricingMode &&
          pricing.pricingMode === LogisticsPricingMode.PER_CARTON)
          ? dto.cartonSize ?? pricing.cartonSize
          : null,
    });

    if (
      pricing.pricingMode === LogisticsPricingMode.PER_CARTON &&
      !pricing.cartonSize
    ) {
      throw new BadRequestException('cartonSize is required for per_carton');
    }

    return this.logisticsPricingRepo.save(pricing);
  }

  async remove(id: string) {
    const pricing = await this.findOne(id);
    await this.logisticsPricingRepo.softRemove(pricing);
  }

  async calculateForCart(
    cartData: CartData,
    stateIdentifier?: string,
  ): Promise<{ deliveryFee: number; lines: LogisticsFeeLine[]; state?: any }> {
    if (!stateIdentifier) {
      throw new BadRequestException('Delivery state is required');
    }

    const state = await this.resolveState(stateIdentifier);
    const pricingRules = await this.logisticsPricingRepo.find({
      where: { state: { id: state.id }, isActive: true },
      relations: ['state'],
    });
    const lines: LogisticsFeeLine[] = [];
    const chargedPerOrderRules = new Set<string>();

    for (const [productLocationId, units] of Object.entries(cartData)) {
      for (const [unit, itemData] of Object.entries(units)) {
        const productLocation = itemData.productLocation as
          | ProductLocationEntity
          | undefined;
        const product = productLocation?.product;
        const quantity = Number(itemData.quantity || 0);
        if (!product || quantity <= 0) continue;

        const rule = this.findBestRule(pricingRules, product, unit);
        const pricingMode =
          rule?.pricingMode ?? LogisticsPricingMode.PER_CARTON;
        const price = Number(rule?.price ?? this.defaultCartonPrice);
        const cartonSize = rule?.cartonSize ?? this.defaultCartonSize;

        if (
          rule &&
          pricingMode === LogisticsPricingMode.PER_ORDER &&
          chargedPerOrderRules.has(rule.id)
        ) {
          continue;
        }

        const chargedUnits = this.calculateChargedUnits(
          pricingMode,
          quantity,
          cartonSize,
          unit,
        );
        const amount = Number((price * chargedUnits).toFixed(2));
        if (pricingMode === LogisticsPricingMode.PER_ORDER && rule) {
          chargedPerOrderRules.add(rule.id);
        }

        lines.push({
          productLocationId,
          productName: product.name,
          category: product.category,
          subCategory: product.subCategory,
          unit,
          quantity,
          pricingId: rule?.id ?? 'default',
          pricingMode,
          price,
          cartonSize:
            pricingMode === LogisticsPricingMode.PER_CARTON
              ? cartonSize
              : undefined,
          chargedUnits,
          amount,
        });
      }
    }

    return {
      deliveryFee: Number(
        lines.reduce((total, line) => total + line.amount, 0).toFixed(2),
      ),
      lines,
      state: { id: state.id, name: state.name, code: state.code },
    };
  }

  private async resolveState(identifier: string) {
    const trimmed = identifier.trim();
    const state = await this.stateRepo.findOne({
      where: [
        { id: trimmed },
        { name: ILike(trimmed) },
        { code: ILike(trimmed) },
      ],
    });

    if (!state) {
      throw new NotFoundException(`Delivery state ${identifier} not found`);
    }
    return state;
  }

  private findBestRule(
    rules: LogisticsPricingEntity[],
    product: ProductLocationEntity['product'],
    unit: string,
  ) {
    return rules
      .filter((rule) => this.matchesRule(rule, product, unit))
      .sort((a, b) => this.specificity(b) - this.specificity(a))[0];
  }

  private matchesRule(
    rule: LogisticsPricingEntity,
    product: ProductLocationEntity['product'],
    unit: string,
  ) {
    return (
      (!rule.primaryCategory ||
        rule.primaryCategory === product.primaryCategory) &&
      (!rule.category || rule.category === product.category) &&
      (!rule.subCategory ||
        rule.subCategory.toLowerCase() ===
          product.subCategory?.toLowerCase()) &&
      (!rule.unit || rule.unit.toLowerCase() === unit.toLowerCase())
    );
  }

  private specificity(rule: LogisticsPricingEntity) {
    return [
      rule.primaryCategory,
      rule.category,
      rule.subCategory,
      rule.unit,
    ].filter(Boolean).length;
  }

  private calculateChargedUnits(
    pricingMode: LogisticsPricingMode,
    quantity: number,
    cartonSize: number,
    unit: string,
  ) {
    if (pricingMode === LogisticsPricingMode.PER_ORDER) return 1;
    if (pricingMode === LogisticsPricingMode.PER_UNIT) return quantity;
    if (unit.toLowerCase().includes('carton')) return quantity;
    return Math.ceil(quantity / cartonSize);
  }
}
