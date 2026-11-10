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
