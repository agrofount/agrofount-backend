import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AddToCartDto } from './dto/create-cart.dto';
import { UpdateCartDto } from './dto/update-cart.dto';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { ProductLocationService } from '../product-location/product-location.service';

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly productLocationService: ProductLocationService,
  ) {}

  async addToCart(userId: string, dto: AddToCartDto) {
    try {
      const { itemId, selectedUOMUnit, quantity } = dto;

      const productLocation = await this.productLocationService.findById(
        itemId,
      );
      const uom = productLocation.uom.find(
        (item) => item.unit === selectedUOMUnit,
      );

      if (!uom) {
        throw new BadRequestException('Unit of Measure not found');
      }

      // Find matching VTP tier based on quantity
      let matchedVtp = null;
      if (uom.vtp && uom.vtp.length > 0) {
        matchedVtp = uom.vtp.find(
          (vtp) => quantity >= vtp.minVolume && quantity <= vtp.maxVolume,
        );
      }

      // Calculate price based on VTP or platform price
      const unitPrice = matchedVtp?.price || uom.platformPrice;
      const totalPrice = quantity * unitPrice;

      const cacheKey = `cart:${userId}`;

      // FIXED: Proper cache data retrieval
      let cartData: any = {};

      try {
        const cachedData = await this.cacheManager.get(cacheKey);
        console.log('Raw cached data:', cachedData);

        if (typeof cachedData === 'string') {
          cartData = JSON.parse(cachedData);
        } else if (typeof cachedData === 'object' && cachedData !== null) {
          cartData = cachedData;
        }
      } catch (error) {
        console.log('Error parsing cache, starting with empty cart:', error);
        cartData = {};
      }

      console.log('Current cart data:', cartData);

      // Initialize cart structure
      if (!cartData[itemId]) {
        cartData[itemId] = {};
      }

      if (!cartData[itemId][selectedUOMUnit]) {
        cartData[itemId][selectedUOMUnit] = {
          quantity: 0,
          total: 0,
          priceDetails: {},
        };
      }

      // Update cart item
      cartData[itemId][selectedUOMUnit] = {
        quantity,
        total: totalPrice,
        platformPrice: uom.platformPrice,
        actualUnitPrice: unitPrice,
        productLocation,
        priceDetails: {
          isVolumeDiscount: !!matchedVtp,
          originalUnitPrice: uom.platformPrice,
          discountPercentage: matchedVtp?.discount || 0,
          matchedVtp,
          savings: matchedVtp ? (uom.platformPrice - unitPrice) * quantity : 0,
        },
      };

      // FIXED: Set cache with proper TTL
      await this.cacheManager.set(cacheKey, cartData, 24 * 60 * 60 * 1000); // 24 hours TTL

      console.log('Cart updated successfully');

      // Increment the added to cart count
      await this.productLocationService.incrementAddedToCart(itemId);

      return cartData;
    } catch (error) {
      console.log('Error while adding to cart: ', error);
      throw error; // Re-throw to let NestJS handle the error
    }
  }

  async syncCart(userId: string, items: any[]) {
    const cacheKey = `cart:${userId}`;

    try {
      // Get existing cart or initialize empty one
      const cartData: Record<string, any> = JSON.parse(
        (await this.cacheManager.get(cacheKey)) || '{}',
      );

      // Create lookup set for incoming items (itemId + UOM as composite key)
      const incomingItems = new Set(
        items.map((item) => `${item.itemId}:${item.selectedUOMUnit}`),
      );

      // Step 1: Clean up cart - remove items not in incoming list
      for (const itemId in cartData) {
        for (const uom in cartData[itemId]) {
          if (!incomingItems.has(`${itemId}:${uom}`)) {
            delete cartData[itemId][uom];
          }
        }
        // Remove item if no UOMs left
        if (Object.keys(cartData[itemId]).length === 0) {
          delete cartData[itemId];
        }
      }

      // Step 2: Add/update incoming items
      for (const item of items) {
        const { itemId, selectedUOMUnit, quantity } = item;
        const productLocation = await this.productLocationService.findById(
          itemId,
        );
        const uom = productLocation.uom.find(
          (unit) => unit.unit === selectedUOMUnit,
        );

        if (!uom) {
          throw new BadRequestException('Unit of Measure not found');
        }

        // Find matching VTP tier
        let matchedVtp = null;
        if (uom.vtp && uom.vtp.length > 0) {
          matchedVtp = uom.vtp.find(
            (vtp) => quantity >= vtp.minVolume && quantity <= vtp.maxVolume,
          );
        }

        // Calculate prices
        const unitPrice = matchedVtp?.price || uom.platformPrice;
        const totalPrice = quantity * unitPrice;
        const originalPrice = quantity * uom.platformPrice;
        const savings = matchedVtp ? originalPrice - totalPrice : 0;

        // Update cart item with VTP details
        cartData[itemId] = cartData[itemId] || {};
        cartData[itemId][selectedUOMUnit] = {
          quantity,
          total: totalPrice,
          platformPrice: uom.platformPrice,
          actualUnitPrice: unitPrice,
          productLocation,
          priceDetails: {
            isVolumeDiscount: !!matchedVtp,
            originalUnitPrice: uom.platformPrice,
            discountPercentage: matchedVtp?.discount || 0,
            matchedVtp,
            savings,
          },
        };
        await this.productLocationService.incrementAddedToCart(itemId);
      }

      // Save updated cart
      await this.cacheManager.set(cacheKey, JSON.stringify(cartData));

      return {
        success: true,
        message: 'Cart synced successfully',
        data: cartData,
      };
    } catch (error) {
      console.error('Cart sync error:', error);
      throw error instanceof BadRequestException
        ? error
        : new InternalServerErrorException('Failed to sync cart');
    }
  }

  async getCart(userId: string) {
    try {
      const cacheKey = `cart:${userId}`;
      const cachedData = (await this.cacheManager.get(cacheKey)) || '{}';
      const cartData = cachedData ? JSON.parse(cachedData as string) : {};
      if (!cartData) {
        throw new NotFoundException('Cart not found');
      }

      return { items: cartData };
    } catch (error) {
      console.log('this is the error: ', error);
      return { success: false, message: error.message };
    }
  }

  async update(userId: string, dto: UpdateCartDto) {
    try {
      const { itemId, selectedUOMUnit, quantity } = dto;

      const productLocation = await this.productLocationService.findById(
        itemId,
      );
      const uom = productLocation.uom.find(
        (item) => item.unit === selectedUOMUnit,
      );

      if (!uom) {
        throw new BadRequestException(
          `Unit of Measure ${selectedUOMUnit} not found for product ${itemId}`,
        );
      }

      const cacheKey = `cart:${userId}`;
      const cachedData = (await this.cacheManager.get(cacheKey)) || '{}';
      const cartData = cachedData ? JSON.parse(cachedData as string) : {};

      // Ensure cart structure is correctly initialized
      cartData[itemId] = cartData[itemId] || {};

      if (quantity === 0) {
        // Delete the item from the cart if quantity is zero
        delete cartData[itemId][selectedUOMUnit];
        // If no more UOM units for the item, delete the item
        if (Object.keys(cartData[itemId]).length === 0) {
          delete cartData[itemId];
        }
      } else {
        // Find matching VTP tier based on quantity
        let matchedVtp = null;
        if (uom.vtp && uom.vtp.length > 0) {
          matchedVtp = uom.vtp.find(
            (vtp) => quantity >= vtp.minVolume && quantity <= vtp.maxVolume,
          );
        }

        // Calculate prices
        const unitPrice = matchedVtp?.price || uom.platformPrice;
        const totalPrice = quantity * unitPrice;
        const originalPrice = quantity * uom.platformPrice;
        const savings = matchedVtp ? originalPrice - totalPrice : 0;

        // Update the cart item with VTP details
        cartData[itemId][selectedUOMUnit] = {
          quantity,
          total: totalPrice,
          platformPrice: uom.platformPrice,
          actualUnitPrice: unitPrice,
          productLocation,
          priceDetails: {
            isVolumeDiscount: !!matchedVtp,
            originalUnitPrice: uom.platformPrice,
            discountPercentage: matchedVtp?.discount || 0,
            matchedVtp,
            savings,
          },
        };
      }

      // Update the user's cart in Redis
      await this.cacheManager.set(cacheKey, JSON.stringify(cartData));

      // Respond to the client
      return cartData;
    } catch (error) {
      console.log('this is the error: ', error);
      return { success: false, message: error.message };
    }
  }

  async clear(id: string) {
    const cacheKey = `cart:${id}`;
    const cachedData: any = await this.cacheManager.get(cacheKey);
    const cartData = cachedData ? JSON.parse(cachedData as string) : {};

    if (!cartData || Object.keys(cartData).length === 0) {
      throw new BadRequestException('No cart found');
    }

    return this.cacheManager.del(cacheKey);
  }
}
