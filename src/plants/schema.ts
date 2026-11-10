import * as z from 'zod';

// Field names match the `plants` table columns. Descriptions are what Claude
// reads when it fills the care sheet, so they carry the conventions.

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();

export const LIGHT = z.enum(['full_sun', 'bright_indirect', 'medium_indirect', 'low']);
export const HUMIDITY = z.enum(['low', 'medium', 'high']);
export const TOXICITY = z.enum(['non_toxic', 'mildly_toxic', 'toxic', 'unknown']);
export const DIFFICULTY = z.enum(['easy', 'moderate', 'hard']);
export const CONFIDENCE = z.enum(['high', 'medium', 'low']);
export const CARE_TYPE = z.enum(['water', 'fertilize', 'repot', 'prune', 'treat', 'mist', 'note']);

export const plantFieldsShape = {
  nickname: text(60).describe('Short household name used in reminders, e.g. "Monstera du salon". Make it unique.'),
  common_name: text(120).describe('French common name, e.g. "Monstera deliciosa (faux philodendron)".'),
  scientific_name: text(160).describe(
    'Botanical name, with the cultivar when it is identifiable, e.g. "Epipremnum aureum \'Marble Queen\'".',
  ),
  family: optionalText(80).describe('Botanical family, e.g. "Araceae".'),
  identification_confidence: CONFIDENCE.describe(
    'How sure the identification is. When it would be "low" and the candidates need different care, ask for another photo instead of adding.',
  ),
  identification_notes: optionalText(800).describe(
    'Features seen on the photo that support the identification, and look-alikes ruled out.',
  ),
  room: text(60).describe('Where the plant lives, e.g. "Salon", "Chambre", "Balcon". Reuse the existing room names.'),
  indoor: z.boolean().describe('true for house plants, false for balcony or garden plants.'),
  light: LIGHT.describe(
    'full_sun: several hours of direct sun · bright_indirect: very bright, little direct sun · medium_indirect: a few metres from a window · low: tolerates dim spots.',
  ),
  light_notes: optionalText(600).describe(
    'Placement advice for this home: window orientation, distance, what to avoid (radiators, draughts…).',
  ),
  water_interval_growing: z
    .number()
    .int()
    .min(1)
    .max(90)
    .describe(
      'Reminder cadence in DAYS during the growing season (April–September), for this plant in its current pot.',
    ),
  water_interval_rest: z
    .number()
    .int()
    .min(1)
    .max(180)
    .describe('Reminder cadence in DAYS during the rest period (October–March), usually longer.'),
  watering_instructions: text(1000).describe(
    'How to water: soil check first (e.g. "top 3 cm dry"), method, drainage, water quality, signs of thirst or excess.',
  ),
  water_amount: optionalText(200).describe(
    "Rough amount for the current pot, e.g. \"≈ 300 ml, jusqu'à ce que l'eau s'écoule par le fond\".",
  ),
  humidity: HUMIDITY.optional().describe('Air humidity it prefers.'),
  humidity_notes: optionalText(600),
  temp_min_c: z.number().min(-40).max(40).optional().describe('Lowest temperature it tolerates, °C.'),
  temp_max_c: z.number().min(0).max(50).optional().describe('Highest comfortable temperature, °C.'),
  temperature_notes: optionalText(600),
  soil: optionalText(600).describe('Potting mix recommendation.'),
  fertilizing: optionalText(600).describe('Fertilizer type, dilution, frequency and season.'),
  repotting: optionalText(600).describe('When and how to repot.'),
  pruning: optionalText(600).describe('Pruning, cleaning leaves, propagation tips.'),
  toxicity_pets: TOXICITY.describe('Toxicity for cats and dogs.'),
  toxicity_notes: optionalText(600).describe('What is toxic and the symptoms; mention children when relevant.'),
  difficulty: DIFFICULTY.optional(),
  common_problems: optionalText(1000).describe(
    'Symptoms to watch for and their usual causes (yellow leaves, brown tips, pests…).',
  ),
  tips: optionalText(1000).describe('Anything else worth knowing for this plant.'),
  pot: optionalText(300).describe('Pot seen on the photo: size, material, drainage hole, cachepot.'),
} as const;

export const plantFieldsSchema = z.object(plantFieldsShape);
export type PlantFields = z.infer<typeof plantFieldsSchema>;

export const plantFieldsPatchSchema = plantFieldsSchema.partial();
export type PlantFieldsPatch = z.infer<typeof plantFieldsPatchSchema>;

/** Household fields editable in the app and through update_plant. */
export const householdFieldsShape = {
  notes: z.string().trim().max(2000).nullable().optional().describe('Free household notes (null clears them).'),
  reminders_enabled: z.boolean().optional().describe('false stops watering reminders for this plant.'),
} as const;

export const PLANT_COLUMNS = Object.keys(plantFieldsShape) as (keyof PlantFields)[];
