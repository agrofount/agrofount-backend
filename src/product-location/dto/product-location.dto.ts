import { ApiProperty } from '@nestjs/swagger';
import { ProductLocationEntity } from '../entities/product-location.entity';
import { UomDto } from './create-product-location.dto';
import { StateResponseDto } from '../../state/dto/state.dto';
import { CountryResponseDto } from '../../country/dto/country.response.dto';
import { ProductResponseDto } from '../../product/dto/product.response.dto';

export class ProductLocationResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the product location',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'price of the product',
    example: '98_000',
  })
  price: number;

  @ApiProperty({
    description: 'Unit of measure',
    type: [UomDto],
  })
  uom: UomDto[];

  @ApiProperty({
    description: 'minimum order quantity',
    example: 5,
  })
  moq: number;

  @ApiProperty({
    description: 'Indicates if the state is active',
    example: true,
  })
  isAvailable: boolean;

  @ApiProperty({
    description: 'country',
  })
  country: CountryResponseDto;

  @ApiProperty({
    description: 'state',
  })
  state: StateResponseDto;

  @ApiProperty({
    description: 'product',
  })
  product: ProductResponseDto;

  @ApiProperty({
    description: 'Date when the state was created',
    example: '2023-01-01T00:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Date when the state was last updated',
    example: '2023-01-01T00:00:00.000Z',
  })
  updatedAt: Date;

  constructor(productLocation: ProductLocationEntity) {
    this.id = productLocation.id;
    this.price = productLocation.price;
    this.isAvailable = productLocation.isAvailable;
    this.uom = productLocation.uom;
    this.moq = productLocation.moq;
    this.country = productLocation.country;
    this.state = productLocation.state;
    this.product = productLocation.product;
    this.createdAt = productLocation.createdAt;
    this.updatedAt = productLocation.updatedAt;
  }
}
