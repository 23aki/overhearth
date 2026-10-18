export const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? "http://127.0.0.1:8000";
export const MCP_URL = `${BACKEND_URL}/mcp`;
export const ASSISTANT_URL = `${BACKEND_URL}/assistant/turn`;
export const DEV_TICK_URL = `${BACKEND_URL}/dev/tick`;
export const SHOW_DEV_TICK = import.meta.env.VITE_DEV_TICK === "1";

export interface DemoHousehold {
  token: string;
  avatar: string;
  label: string;
}

/** Simulated demo households. Their tokens stand in for Alexa account linking. */
export const DEMO_HOUSEHOLDS: DemoHousehold[] = [
  { token: "demo-tokyo", avatar: "Kiri", label: "a studio apartment in Tokyo" },
  { token: "demo-osaka", avatar: "Ume", label: "a retired cook's home in Osaka" },
  { token: "demo-seattle", avatar: "Juniper", label: "a family of four in Seattle" },
  { token: "demo-austin", avatar: "Pip", label: "a student in Austin" },
];
