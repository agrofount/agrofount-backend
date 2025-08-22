export interface UserNotificationData {
  name: string;
  email: string;
  phone: string;
  updates: ProductUpdate[];
}

export interface ProductUpdate {
  product: string;
  oldPrice: number;
  newPrice: number;
  percentageChange: string;
}
