/** The town as the server describes it (GET /town, or the get_town_state tool). */

export interface Home {
  id: string;
  label: string;
  avatar: string;
  tier: "demo" | "background" | "real" | string;
  region: string;
  /** The home's language code: its avatar speaks it in town. */
  language?: string;
  /** How often know-how from this home was thanked. */
  glow: number;
}

export interface Line {
  speaker: string;
  text: string;
  /** Language code of the line. */
  lang?: string;
  /** English translation, for lines not in English. */
  gloss?: string | null;
}

export interface HandedItem {
  kind: string;
  /** Household id of the avatar that handed it over. */
  from: string;
}

export interface TownEvent {
  id: string;
  tick: number;
  at: string;
  type: "encounter" | "exchange" | "thanks_flow" | "return" | "town";
  actors: string[];
  summary: string;
  refs: string[];
  detail: {
    lines?: Line[];
    items?: HandedItem[];
    from?: string[];
    to?: string;
    count?: number;
    /** A "town" event: the landmark that was built, and the town level that built it. */
    landmark?: string;
    level?: number;
    /** The landmark grew bigger rather than being built. */
    upgrade?: boolean;
  };
}

export interface Landmark {
  /** bakery, playground, library, garden, clinic, cafe, bathhouse, stage, market, workshop, petpark, lanterns */
  kind: string;
  level: number;
  at: string;
}

/** How far the town has grown with thanks, know-how and chats. */
export interface Growth {
  level: number;
  xp: number;
  /** XP at which the current level started. */
  level_xp: number;
  /** XP the next level needs; null at the top. */
  next_xp: number | null;
  landmarks: Landmark[];
  /** Landmarks made bigger, once every landmark stands. */
  upgrades?: Landmark[];
  /** The landmark kind the most thanked topic points to. */
  leading?: string | null;
}

export interface TownState {
  /** The household looking at the town, when there is one (the MCP App). */
  viewer?: string;
  homes: Home[];
  events: TownEvent[];
  /** Homes talking with their Alexa right now: {id: {kind, ago}}. */
  active?: Record<string, { kind: string; ago: number }>;
  growth?: Growth | null;
}

export function latestTick(state: TownState): number {
  return Math.max(0, ...state.events.map((e) => e.tick));
}
