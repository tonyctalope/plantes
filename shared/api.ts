// JSON contract between the server (src/api) and the web app (web/src).
// Both sides import these types: change them here and `npm run typecheck`
// points at every place that has to follow.

export type Light = 'full_sun' | 'bright_indirect' | 'medium_indirect' | 'low';
export type Humidity = 'low' | 'medium' | 'high';
export type Toxicity = 'non_toxic' | 'mildly_toxic' | 'toxic' | 'unknown';
export type Difficulty = 'easy' | 'moderate' | 'hard';
export type Confidence = 'high' | 'medium' | 'low';
export type CareType = 'water' | 'fertilize' | 'repot' | 'prune' | 'treat' | 'mist' | 'note';
export type CareSource = 'web' | 'mcp' | 'notification';
/** overdue: due date passed · due: today · soon: within 2 days · ok: later */
export type WaterState = 'overdue' | 'due' | 'soon' | 'ok';
/** growing = April–September by default, rest = October–March */
export type Season = 'growing' | 'rest';

export const LIGHTS: readonly Light[] = ['full_sun', 'bright_indirect', 'medium_indirect', 'low'];
export const HUMIDITIES: readonly Humidity[] = ['low', 'medium', 'high'];
export const TOXICITIES: readonly Toxicity[] = ['non_toxic', 'mildly_toxic', 'toxic', 'unknown'];
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'moderate', 'hard'];
export const CONFIDENCES: readonly Confidence[] = ['high', 'medium', 'low'];
export const CARE_TYPES: readonly CareType[] = ['water', 'fertilize', 'repot', 'prune', 'treat', 'mist', 'note'];

export interface UserSummary {
  id: number;
  email: string;
  name: string | null;
}

export interface WaterStatus {
  /** ISO timestamp of the last "water" event, null when none was ever logged. */
  lastWateredAt: string | null;
  /** Display name of whoever logged the last watering. */
  lastWateredBy: string | null;
  /** Interval (days) of the current season. */
  intervalDays: number;
  season: Season;
  /** YYYY-MM-DD in the household time zone. */
  dueDate: string;
  /** Negative when overdue, 0 when due today. */
  daysUntilDue: number;
  state: WaterState;
  /** YYYY-MM-DD, set by "reporter" (snooze); cleared by the next watering. */
  snoozedUntil: string | null;
}

export interface PhotoUrls {
  /** 480×480 crop, for lists. */
  thumb: string;
  /** Up to 1600 px on the long side. */
  full: string;
}

export interface PlantSummary {
  id: number;
  nickname: string;
  commonName: string;
  scientificName: string;
  room: string;
  photo: PhotoUrls | null;
  remindersEnabled: boolean;
  toxicityPets: Toxicity;
  water: WaterStatus;
  archivedAt: string | null;
  /** Why it was archived ("morte", "donnée"…), when given. */
  archiveReason: string | null;
}

/** The care sheet Claude fills in when the plant is added (all free text is French). */
export interface CareSheet {
  family: string | null;
  identificationConfidence: Confidence;
  identificationNotes: string | null;
  indoor: boolean;
  light: Light;
  lightNotes: string | null;
  waterIntervalGrowing: number;
  waterIntervalRest: number;
  wateringInstructions: string;
  waterAmount: string | null;
  humidity: Humidity | null;
  humidityNotes: string | null;
  tempMinC: number | null;
  tempMaxC: number | null;
  temperatureNotes: string | null;
  soil: string | null;
  fertilizing: string | null;
  repotting: string | null;
  pruning: string | null;
  toxicityNotes: string | null;
  difficulty: Difficulty | null;
  commonProblems: string | null;
  tips: string | null;
  pot: string | null;
}

export interface CareEvent {
  id: number;
  type: CareType;
  /** ISO timestamp. */
  at: string;
  /** Display name of the household member, null if unknown/deleted. */
  by: string | null;
  source: CareSource;
  note: string | null;
}

export interface PlantDetail extends PlantSummary {
  care: CareSheet;
  /** Free household notes, editable in the app. */
  notes: string | null;
  createdAt: string;
  createdBy: string | null;
  /** Name of the MCP client that added it (e.g. "Claude"). */
  createdVia: string;
  lastFertilizedAt: string | null;
  /** Most recent first, at most 50. */
  events: CareEvent[];
}

export interface UserSettings {
  remindersEnabled: boolean;
  /** HH:MM, household time zone. */
  reminderTime: string;
}

export interface MeResponse {
  user: UserSummary;
  /** Every allowlisted person who has logged in at least once. */
  household: UserSummary[];
  settings: UserSettings;
  push: {
    vapidPublicKey: string;
    /** Number of devices of this user subscribed to notifications. */
    subscriptions: number;
  };
  /** URL to give to Claude as a custom connector / `claude mcp add`. */
  mcpUrl: string;
  timezone: string;
  /** Today in the household time zone (YYYY-MM-DD). */
  today: string;
}

export interface PlantsResponse {
  plants: PlantSummary[];
  /** Distinct rooms of active plants, sorted. */
  rooms: string[];
  today: string;
}

export interface PlantPatch {
  nickname?: string;
  room?: string;
  notes?: string | null;
  waterIntervalGrowing?: number;
  waterIntervalRest?: number;
  remindersEnabled?: boolean;
}

export interface CareRequest {
  type: CareType;
  note?: string;
  /** ISO timestamp; defaults to now. Cannot be in the future. */
  at?: string;
  source?: CareSource;
}

export interface BulkWaterRequest {
  ids: number[];
}

export interface SnoozeRequest {
  /** 1–14 days from today. */
  days: number;
}

export interface ArchiveRequest {
  reason?: string;
}

export interface PushSubscriptionRequest {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface Connection {
  id: string;
  clientName: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ConnectionsResponse {
  connections: Connection[];
}

export interface ApiError {
  error: string;
  message: string;
}

/**
 * Web API (all under the session cookie, JSON in/out unless noted).
 * Unsafe methods require a same-origin `Origin` header.
 *
 *   GET    /api/me                          → MeResponse            (401 when logged out)
 *   GET    /api/plants[?archived=1]         → PlantsResponse
 *   GET    /api/plants/:id                  → PlantDetail
 *   PATCH  /api/plants/:id        PlantPatch → PlantDetail
 *   POST   /api/plants/:id/care   CareRequest → PlantDetail
 *   DELETE /api/plants/:id/care/:eventId    → PlantDetail
 *   POST   /api/plants/water  BulkWaterRequest → PlantsResponse
 *   POST   /api/plants/:id/snooze SnoozeRequest → PlantDetail
 *   POST   /api/plants/:id/archive ArchiveRequest → PlantDetail
 *   POST   /api/plants/:id/unarchive        → PlantDetail
 *   DELETE /api/plants/:id                  → 204
 *   POST   /api/plants/:id/photo  multipart field "photo" → PlantDetail
 *   PUT    /api/settings          UserSettings → UserSettings
 *   POST   /api/push/subscriptions PushSubscriptionRequest → 204
 *   DELETE /api/push/subscriptions {endpoint} → 204
 *   POST   /api/push/test                   → { sent: number }
 *   GET    /api/connections                 → ConnectionsResponse
 *   DELETE /api/connections/:id             → 204
 *   POST   /auth/logout                     → 204
 *   GET    /auth/google/start[?next=/path]  → redirect to Google (plain link, not fetch)
 */
export type ApiDoc = never;
