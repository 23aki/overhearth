/**
 * Account linking for a real household: OAuth 2.1 authorization code + PKCE (S256), the way
 * Alexa+ links an account to an MCP server. The demo households skip this with pre-issued tokens.
 */
import { BACKEND_URL } from "./config";

const CLIENT_ID = "overhearth-web";
const LINKED_KEY = "overhearth.linked-home";
const PENDING_KEY = "overhearth.linking";
const REFRESH_MARGIN_MS = 60_000;

export interface LinkedHome {
  token: string;
  refreshToken: string;
  expiresAt: number;
  avatar: string;
  label: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  household?: { avatar: string; label: string };
  error?: string;
  error_description?: string;
}

// Storage can be unavailable (private windows, blocked site data); linking then lasts one page.
function load<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function save(storage: Storage, key: string, value: unknown): void {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore; see load().
  }
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return btoa(String.fromCharCode(...view)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const redirectUri = () => `${location.origin}/`;

/** Go to the authorization page. The browser comes back to this page with a code. */
export async function startLinking(): Promise<void> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
  save(sessionStorage, PENDING_KEY, { verifier, state });
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "mcp:tools mcp:resources",
    state,
  });
  location.assign(`${BACKEND_URL}/authorize?${params}`);
}

async function requestToken(form: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(`${BACKEND_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...form }),
  });
  const body = (await response.json()) as TokenResponse;
  if (!response.ok) throw new Error(body.error_description ?? body.error ?? "Linking failed.");
  return body;
}

function remember(body: TokenResponse, previous?: LinkedHome): LinkedHome {
  const home: LinkedHome = {
    token: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000,
    avatar: body.household?.avatar ?? previous?.avatar ?? "Your avatar",
    label: body.household?.label ?? previous?.label ?? "your home",
  };
  save(localStorage, LINKED_KEY, home);
  return home;
}

/**
 * If the page was opened by the authorization redirect, exchange the code for tokens.
 * Returns the linked home, or throws with a message to show.
 */
export async function finishLinking(): Promise<LinkedHome | null> {
  const url = new URL(location.href);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (!code && !error) return null;
  const returnedState = url.searchParams.get("state");
  history.replaceState(null, "", url.pathname);
  const pending = load<{ verifier: string; state: string }>(sessionStorage, PENDING_KEY);
  save(sessionStorage, PENDING_KEY, null);
  if (error) throw new Error(url.searchParams.get("error_description") ?? "Linking was cancelled.");
  if (!pending || pending.state !== returnedState) throw new Error("Linking expired. Please try again.");
  const body = await requestToken({
    grant_type: "authorization_code",
    code: code!,
    redirect_uri: redirectUri(),
    code_verifier: pending.verifier,
  });
  return remember(body);
}

export function linkedHome(): LinkedHome | null {
  return load<LinkedHome>(localStorage, LINKED_KEY);
}

export function forgetLinkedHome(): void {
  save(localStorage, LINKED_KEY, null);
}

/** A usable access token, refreshing it first when it is about to expire. */
export async function freshLinkedHome(home: LinkedHome): Promise<LinkedHome> {
  if (home.expiresAt - REFRESH_MARGIN_MS > Date.now()) return home;
  const body = await requestToken({ grant_type: "refresh_token", refresh_token: home.refreshToken });
  return remember(body, home);
}
