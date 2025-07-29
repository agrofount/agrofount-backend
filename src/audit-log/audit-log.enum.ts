export const enum AuditEntityType {
  USER = 'User',
  ORDER = 'Order',
  PRODUCT = 'Product',
  PAYMENT = 'Payment',
  SHIPMENT = 'Shipment',
  DISCOUNT = 'Discount',
}

export const enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  APPLY_DISCOUNT = 'APPLY_DISCOUNT',
  PROCESS_SHIPMENT = 'PROCESS_SHIPMENT',
}
