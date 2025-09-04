import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { UserService } from '../../../user/user.service';

@Injectable()
export class RagContextService {
  private readonly logger = new Logger(RagContextService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly userService: UserService,
  ) {}

  async enrichWithRealTimeContext(
    sessionData: any,
    userId: string,
  ): Promise<string> {
    const contextPieces: string[] = [];

    try {
      // 1. User profile context
      const userContext = await this.getUserContext(userId);
      if (userContext) contextPieces.push(userContext);

      // 2. Location context
      const locationContext = await this.getLocationContext(userId);
      if (locationContext) contextPieces.push(locationContext);

      // 3. Weather context
      if (sessionData.userState || locationContext.includes('state')) {
        const state =
          this.extractState(locationContext) || sessionData.userState;
        if (state) {
          const weatherContext = await this.getWeatherContext(state);
          if (weatherContext) contextPieces.push(weatherContext);
        }
      }

      // 4. Seasonal context
      contextPieces.push(this.getSeasonalContext());

      // 5. Market context
      const marketContext = await this.getMarketContext(sessionData.animalType);
      if (marketContext) contextPieces.push(marketContext);
    } catch (error) {
      this.logger.error('Error enriching context:', error);
      // Return basic context even if some parts fail
      contextPieces.push(this.getBasicContext());
    }

    return contextPieces.filter(Boolean).join('\n');
  }

  private async getUserContext(userId: string): Promise<string> {
    try {
      // const user = await this.userService.findById(userId);
      // if (user) {
      //   return `Farmer profile: ${user.farmSize || 'Unknown'} farm size, ${user.experienceLevel || 'Unknown'} experience level.`;
      // }
      return 'Farmer: Experience level unknown.';
    } catch (error) {
      this.logger.warn('User context unavailable');
      return '';
    }
  }

  private async getLocationContext(userId: string): Promise<string> {
    try {
      // const user = await this.userService.findById(userId);
      // if (user?.state) {
      //   return `Location: ${user.state} state, Nigeria.`;
      // }
      return 'Location: Nigeria (specific state unknown).';
    } catch (error) {
      this.logger.warn('Location context unavailable');
      return 'Location: Nigeria.';
    }
  }

  private extractState(locationContext: string): string | null {
    const match = locationContext.match(/state:?\s*([^,\.]+)/i);
    return match ? match[1].trim() : null;
  }

  private async getWeatherContext(state: string): Promise<string> {
    try {
      const apiKey = this.configService.get('WEATHER_API_KEY');
      if (!apiKey) {
        return `Seasonal advice: ${this.getNigerianSeasonalAdvice()}`;
      }

      const response = await firstValueFrom(
        this.httpService.get(
          `https://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${state},Nigeria`,
        ),
      );
      const weather = response.data.current;
      return `Current weather in ${state}: ${weather.condition.text}, ${
        weather.temp_c
      }°C. ${this.getWeatherAdvice(weather)}`;
    } catch (error) {
      this.logger.warn('Weather API unavailable');
      return `Seasonal context: ${this.getNigerianSeasonalAdvice()}`;
    }
  }

  private getWeatherAdvice(weather: any): string {
    if (weather.precip_mm > 5) {
      return 'Heavy rainfall expected. Ensure proper drainage and shelter for animals.';
    } else if (weather.temp_c > 35) {
      return 'High temperatures. Ensure adequate water supply and shade for livestock.';
    } else if (weather.humidity > 80) {
      return 'High humidity. Watch for fungal diseases and ensure good ventilation.';
    }
    return 'Moderate weather conditions. Good for agricultural activities.';
  }

  private getSeasonalContext(): string {
    const now = new Date();
    const month = now.getMonth() + 1;
    const season = this.getNigerianSeason(month);
    return `Current season: ${season}.`;
  }

  private getNigerianSeason(month: number): string {
    if (month >= 3 && month <= 5) return 'Late Dry Season (Hot and dry)';
    if (month >= 6 && month <= 9) return 'Rainy Season (Wet and humid)';
    if (month >= 10 && month <= 11)
      return 'Early Dry Season (Harmattan begins)';
    return 'Dry Season (Harmattan)';
  }

  private getNigerianSeasonalAdvice(): string {
    const month = new Date().getMonth() + 1;
    if (month >= 6 && month <= 9) {
      return 'Rainy season - ideal for planting, watch for waterborne diseases in livestock.';
    } else if (month >= 10 && month <= 11) {
      return 'Early dry season - harvest time, prepare for harmattan dust.';
    } else {
      return 'Dry season - focus on irrigation and water management.';
    }
  }

  private async getMarketContext(animalType: string): Promise<string> {
    try {
      // Mock market data - replace with actual API integration
      const marketData = {
        poultry: 'Poultry feed prices stable. High demand for day-old chicks.',
        cattle: 'Beef prices rising. Good market for dairy products.',
        fish: 'Fish feed costs increasing. Tilapia market strong.',
        default: 'Agricultural markets showing moderate activity.',
      };

      return `Market insight: ${marketData[animalType] || marketData.default}`;
    } catch (error) {
      this.logger.warn('Market context unavailable');
      return '';
    }
  }

  private getBasicContext(): string {
    return `Context: Nigerian agricultural setting. Current season: ${this.getNigerianSeason(
      new Date().getMonth() + 1,
    )}.`;
  }
}
