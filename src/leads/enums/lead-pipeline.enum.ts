/** Pipeline stage. "ordered_paid" is only ever set by the system. */
export enum LeadStage {
  New = 'new',
  Contacted = 'contacted',
  Visited = 'visited',
  Quoted = 'quoted',
  OrderedPaid = 'ordered_paid',
  Lost = 'lost',
}

export enum LeadLostReason {
  Price = 'price',
  NoStock = 'no_stock',
  Timing = 'timing',
  Competitor = 'competitor',
  Unreachable = 'unreachable',
  Other = 'other',
}

export enum LeadBuyerType {
  Smallholder = 'smallholder',
  CommercialFarm = 'commercial_farm',
  Cooperative = 'cooperative',
  AgroDealer = 'agro_dealer',
  Institution = 'institution',
}

export enum LeadProductInterest {
  DayOldChicks = 'day_old_chicks',
  Feed = 'feed',
  MedicationVaccines = 'medication_vaccines',
  OtherInputs = 'other_inputs',
  Mixed = 'mixed',
}

export enum LeadFarmSizeUnit {
  Birds = 'birds',
  Fish = 'fish',
  Hectares = 'hectares',
}

export enum LeadActivityType {
  Call = 'call',
  Whatsapp = 'whatsapp',
  Visit = 'visit',
  Quote = 'quote',
  Note = 'note',
}

export enum LeadActorType {
  Admin = 'admin',
  System = 'system',
}

/** How an order was attributed to a staff member. */
export enum OrderAttributionSource {
  LeadOwner = 'lead_owner',
  ReferralCode = 'referral_code',
  LoggedLead = 'logged_lead',
  Unattributed = 'unattributed',
}

export enum TargetPeriodType {
  Week = 'week',
  Quarter = 'quarter',
}
