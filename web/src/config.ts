interface RuntimeConfig {
  backendUrl?: string;
  devTick?: boolean;
  accessKey?: string;
}

/** Set by /config.js, which the deployment writes; falls back to Vite env variables. */
const runtime: RuntimeConfig = (window as { __OVERHEARTH__?: RuntimeConfig }).__OVERHEARTH__ ?? {};

export const BACKEND_URL =
  runtime.backendUrl ?? (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? "http://127.0.0.1:8000";
export const MCP_URL = `${BACKEND_URL}/mcp`;
export const ASSISTANT_URL = `${BACKEND_URL}/assistant/turn`;
export const DEV_TICK_URL = `${BACKEND_URL}/dev/tick`;
/** Headers every backend call needs; the access key is only set while the demo is gated. */
export function apiHeaders(): Record<string, string> {
  const key = runtime.accessKey ?? (import.meta.env.VITE_ACCESS_KEY as string | undefined);
  return key ? { "X-Overhearth-Access": key } : {};
}

export const SHOW_DEV_TICK = runtime.devTick ?? import.meta.env.VITE_DEV_TICK === "1";

export interface DemoHousehold {
  token: string;
  /** The home's language: Alexa speaks and listens in it. */
  lang: string;
  avatar: string;
  label: string;
}

/** Simulated demo households. Their tokens stand in for Alexa account linking. */
export const DEMO_HOUSEHOLDS: DemoHousehold[] = [
  { token: "demo-seattle", avatar: "Juniper", label: "a family of four in Seattle", lang: "en" },
  { token: "demo-austin", avatar: "Pip", label: "a student in Austin", lang: "en" },
  { token: "demo-tokyo", avatar: "Kiri", label: "a studio apartment in Tokyo", lang: "ja" },
  { token: "demo-osaka", avatar: "Ume", label: "a retired cook's home in Osaka", lang: "ja" },
];
