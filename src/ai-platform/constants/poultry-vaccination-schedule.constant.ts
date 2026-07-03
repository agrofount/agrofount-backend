export type PoultryVaccinationScheduleEntry = {
  vaccineName: string;
  targetDay: number;
  windowDays: number;
  method: string;
};

// Simplified v1 schedule for standard Nigerian broiler/layer poultry operations.
// windowDays is how many days past targetDay the dose is still considered "due"
// before it's treated as missed.
export const POULTRY_VACCINATION_SCHEDULE: PoultryVaccinationScheduleEntry[] = [
  {
    vaccineName: 'Newcastle Disease (Lasota) - Dose 1',
    targetDay: 7,
    windowDays: 3,
    method: 'Eye drop or drinking water',
  },
  {
    vaccineName: 'Gumboro (IBD) - Dose 1',
    targetDay: 14,
    windowDays: 3,
    method: 'Drinking water',
  },
  {
    vaccineName: 'Newcastle Disease (Lasota) - Dose 2',
    targetDay: 21,
    windowDays: 3,
    method: 'Drinking water',
  },
  {
    vaccineName: 'Gumboro (IBD) - Dose 2',
    targetDay: 28,
    windowDays: 3,
    method: 'Drinking water',
  },
  {
    vaccineName: 'Fowl Pox',
    targetDay: 42,
    windowDays: 7,
    method: 'Wing-web stab',
  },
  {
    vaccineName: 'Newcastle Disease (Lasota) - Booster',
    targetDay: 84,
    windowDays: 7,
    method: 'Drinking water',
  },
];
