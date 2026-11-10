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
  water_amount: optionalText(200).describe('Rough amount for the current pot, SHORT (shown as a pill): "≈ 300 ml".'),
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

// Structured care facts shown as tiles and pills in the app. Short phrases
// (2–6 words, no final period) except key_tips. Stored as JSON in plants.care_details.
const phrase = (max: number) => z.string().trim().min(1).max(max);
const phrases = (max: number, count: number) => z.array(phrase(max)).max(count);

export const careDetailsShape = {
  light_good: phrases(50, 5)
    .optional()
    .describe('Good spots, 2–6 words each: "Fenêtre est ou ouest", "1–2 m d\'une fenêtre sud".'),
  light_avoid: phrases(50, 5)
    .optional()
    .describe('Spots/conditions to avoid: "Soleil direct de midi", "Radiateur", "Courants d\'air".'),
  watering_rule: phrase(80)
    .optional()
    .describe('When to water, one short line: "Quand les 2/3 du substrat sont secs".'),
  watering_tips: phrases(50, 5)
    .optional()
    .describe('How to water: "Par le bas, 15 min", "Vider la soucoupe", "Eau reposée".'),
  thirst_signs: phrase(90).optional().describe('What thirst looks like: "Feuilles molles et plissées".'),
  overwatering_signs: phrase(90)
    .optional()
    .describe('What too much water looks like: "Feuilles jaunes, tige noire à la base".'),
  humidity_tips: phrases(50, 4).optional().describe('"40–60 %", "Ne pas brumiser", "Billes d\'argile humides".'),
  temp_ideal: phrase(30).optional().describe('Ideal range, e.g. "18–25 °C" (temp_min_c/temp_max_c stay the limits).'),
  soil_mix: phrases(50, 5).optional().describe('Potting mix parts: "1/2 terreau plantes vertes", "1/4 perlite".'),
  fertilizer_frequency: phrase(40).optional().describe('"Toutes les 3 semaines".'),
  fertilizer_season: phrase(40).optional().describe('"Avril → septembre".'),
  fertilizer_type: phrase(60).optional().describe('"Engrais plantes vertes, demi-dose".'),
  repotting_frequency: phrase(40).optional().describe('"Tous les 2–3 ans".'),
  repotting_season: phrase(50).optional().describe('"Printemps".'),
  pruning_tips: phrases(70, 4)
    .optional()
    .describe('"Couper au-dessus d\'un nœud au printemps", "Bouture de tige dans l\'eau".'),
  problems: z
    .array(z.object({ symptom: phrase(70), cause: phrase(90) }))
    .max(6)
    .optional()
    .describe(
      'Most common issues as symptom → cause: {symptom: "Feuilles jaunes, sol humide", cause: "Excès d\'eau"}.',
    ),
  key_tips: phrases(140, 4).optional().describe('1–4 key tips, one short sentence each.'),
  pet_risk: phrase(100).optional().describe('One line on the risk for cats/dogs: "Saponines : bave, vomissements".'),
} as const;

export const careDetailsSchema = z.object(careDetailsShape);
export type CareDetailsInput = z.infer<typeof careDetailsSchema>;
