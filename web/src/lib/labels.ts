import type {
  CareSource,
  CareType,
  Confidence,
  Difficulty,
  Humidity,
  Light,
  Season,
  Toxicity,
} from '../../../shared/api.ts';

export const lightLabel: Record<Light, string> = {
  full_sun: 'Plein soleil',
  bright_indirect: 'Lumière vive indirecte',
  medium_indirect: 'Lumière moyenne',
  low: 'Faible luminosité',
};

/** Tile values: the tile label ("Lumière") gives the context. */
export const lightShort: Record<Light, string> = {
  full_sun: 'Plein soleil',
  bright_indirect: 'Vive indirecte',
  medium_indirect: 'Moyenne',
  low: 'Faible',
};

/** Filled steps of the light (4), humidity (3) and difficulty (3) meters. */
export const lightLevel: Record<Light, number> = { low: 1, medium_indirect: 2, bright_indirect: 3, full_sun: 4 };
export const humidityLevel: Record<Humidity, number> = { low: 1, medium: 2, high: 3 };
export const difficultyLevel: Record<Difficulty, number> = { easy: 1, moderate: 2, hard: 3 };

export const lightHint: Record<Light, string> = {
  full_sun: 'Plusieurs heures de soleil direct par jour.',
  bright_indirect: 'Beaucoup de clarté, sans soleil direct sur les feuilles.',
  medium_indirect: 'Lumière tamisée, un peu en retrait des fenêtres.',
  low: 'Se contente des coins peu éclairés.',
};

export const humidityLabel: Record<Humidity, string> = {
  low: 'Faible',
  medium: 'Moyenne',
  high: 'Élevée',
};

export const toxicityLabel: Record<Toxicity, string> = {
  non_toxic: 'Sans danger pour les animaux',
  mildly_toxic: 'Légèrement toxique pour les animaux',
  toxic: 'Toxique pour les animaux',
  unknown: 'Toxicité inconnue',
};

export const toxicityShort: Record<Toxicity, string> = {
  non_toxic: 'Sans danger',
  mildly_toxic: 'Légèrement toxique',
  toxic: 'Toxique',
  unknown: 'Toxicité ?',
};

export const toxicityTile: Record<Toxicity, string> = {
  non_toxic: 'Sans danger',
  mildly_toxic: 'Un peu toxique',
  toxic: 'Toxique',
  unknown: 'Inconnue',
};

export const difficultyLabel: Record<Difficulty, string> = {
  easy: 'Facile',
  moderate: 'Intermédiaire',
  hard: 'Exigeante',
};

export const confidenceLabel: Record<Confidence, string> = {
  high: 'Identification sûre',
  medium: 'Identification probable',
  low: 'Identification incertaine',
};

export const confidenceShort: Record<Confidence, string> = {
  high: 'Sûre',
  medium: 'Probable',
  low: 'Incertaine',
};

export const careLabel: Record<CareType, string> = {
  water: 'Arrosage',
  fertilize: 'Engrais',
  repot: 'Rempotage',
  prune: 'Taille',
  treat: 'Traitement',
  mist: 'Brumisation',
  note: 'Note',
};

export const sourceLabel: Record<CareSource, string | null> = {
  web: null,
  mcp: 'via Claude',
  notification: 'depuis une notification',
};

export const seasonLabel: Record<Season, string> = {
  growing: 'Avril → septembre',
  rest: 'Octobre → mars',
};

export const seasonName: Record<Season, string> = {
  growing: 'croissance',
  rest: 'repos',
};

export const seasonShort: Record<Season, string> = {
  growing: 'Avr → sept',
  rest: 'Oct → mars',
};
