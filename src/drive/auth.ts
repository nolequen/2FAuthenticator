import { isFirefox } from "../browser";
import {
  DATA_COLLECTION,
  DESKTOP_CLIENT_ID,
  DESKTOP_CLIENT_SECRET,
  DRIVE_AUTH_LOCK,
  DRIVE_SCOPE,
  LOOPBACK_ORIGIN,
  LOOPBACK_REDIRECT,
  WEB_CLIENT_ID,
} from "./config";
import {
  type DriveClient,
  type DriveRecord,
  type DriveToken,
  readDriveRecord,
  readDriveSession,
  updateDriveRecord,
  writeDriveSession,
} from "./state";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const RENEW_MARGIN = 5 * 60 * 1000;
const SILENT_TIMEOUT = 30000;
const REQUEST_TIMEOUT = 30000;
const SIGNIN_ERRORS = [
  "interaction_required",
  "login_required",
  "consent_required",
  "account_selection_required",
  "invalid_grant",
];
const DATA_COLLECTION_PERMISSION = {
  data_collection: [DATA_COLLECTION],
} as chrome.permissions.Permissions;
const LOOPBACK_PERMISSION = { origins: [LOOPBACK_ORIGIN] };

export type DriveAuthFailure = "signin" | "network" | "cancelled" | "denied";

export class DriveAuthError extends Error {
  readonly reason: DriveAuthFailure;

  constructor(reason: DriveAuthFailure, message?: string) {
    super(message ?? reason);
    this.reason = reason;
  }
}

export interface SignInResult {
  session: DriveToken;
  refreshToken?: string;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  refresh_token?: string;
  error?: string;
}

export function driveClient(): DriveClient {
  return isFirefox ? "desktop" : "web";
}

export function driveAvailable(client = driveClient()) {
  return client === "web"
    ? !!WEB_CLIENT_ID
    : !!DESKTOP_CLIENT_ID && !!DESKTOP_CLIENT_SECRET;
}

export function redirectUri(client: DriveClient) {
  if (!chrome.identity) {
    return LOOPBACK_REDIRECT;
  }
  const url = chrome.identity.getRedirectURL();
  if (client === "web") {
    return url;
  }
  return `http://127.0.0.1/mozoauth2/${new URL(url).hostname.split(".")[0]}`;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomString() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64Url(new Uint8Array(digest));
}

function authUrl(params: { [name: string]: string | undefined }) {
  const url = new URL(AUTH_URL);
  for (const [name, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(name, value);
    }
  }
  return url.toString();
}

export function parseRedirect(responseUrl: string, state: string) {
  const url = new URL(responseUrl);
  const params = new URLSearchParams(url.search);
  new URLSearchParams(url.hash.slice(1)).forEach((value, name) =>
    params.set(name, value),
  );
  const error = params.get("error");
  if (error) {
    throw new DriveAuthError(
      SIGNIN_ERRORS.includes(error)
        ? "signin"
        : error === "access_denied"
          ? "denied"
          : "cancelled",
      error,
    );
  }
  if (params.get("state") !== state) {
    throw new DriveAuthError("cancelled", "The state does not match.");
  }
  return params;
}

function toSession(token: TokenResponse | URLSearchParams): DriveToken {
  const accessToken =
    token instanceof URLSearchParams
      ? token.get("access_token")
      : token.access_token;
  const expiresIn = Number(
    token instanceof URLSearchParams
      ? token.get("expires_in")
      : token.expires_in,
  );
  if (!accessToken) {
    throw new DriveAuthError("network", "No access token.");
  }
  return {
    accessToken,
    expiresAt: Date.now() + (expiresIn > 0 ? expiresIn : 3600) * 1000,
  };
}

export function launchInTab(url: string, redirect: string) {
  return new Promise<string>((resolve, reject) => {
    let signInTab: number | undefined;
    let settled = false;

    const settle = () => {
      if (settled) {
        return false;
      }
      settled = true;
      chrome.tabs.onUpdated.removeListener(updated);
      chrome.tabs.onRemoved.removeListener(removed);
      return true;
    };
    const updated = (
      tabId: number,
      changeInfo: { url?: string },
      tab: chrome.tabs.Tab,
    ) => {
      const address = changeInfo.url ?? tab.url;
      if (tabId !== signInTab || !address?.startsWith(redirect) || !settle()) {
        return;
      }
      resolve(address);
      closeSignInTab(tabId);
    };
    const removed = (tabId: number) => {
      if (tabId === signInTab && settle()) {
        reject(new DriveAuthError("cancelled", "The sign-in tab was closed."));
      }
    };

    chrome.tabs.onUpdated.addListener(updated);
    chrome.tabs.onRemoved.addListener(removed);
    chrome.tabs.create({ url }).then(
      (tab) => {
        signInTab = tab.id;
      },
      (error) => {
        if (settle()) {
          reject(new DriveAuthError("cancelled", String(error)));
        }
      },
    );
  });
}

async function closeSignInTab(tabId: number) {
  const current = await chrome.tabs.getCurrent().catch(() => undefined);
  await chrome.tabs
    .remove(tabId)
    .catch((error) => console.warn("Could not close the sign-in tab.", error));
  if (current?.id !== undefined) {
    await chrome.tabs
      .update(current.id, { active: true })
      .catch((error) => console.warn("Could not return to the tab.", error));
  }
}

async function launch(details: chrome.identity.WebAuthFlowDetails) {
  if (!chrome.identity) {
    if (!details.interactive) {
      throw new DriveAuthError("signin", "No identity API.");
    }
    return await launchInTab(details.url, redirectUri("desktop"));
  }
  let responseUrl: string | undefined;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow(details);
  } catch (error) {
    throw new DriveAuthError(
      details.interactive
        ? "cancelled"
        : navigator.onLine && /interaction/i.test(String(error))
          ? "signin"
          : "network",
      String(error),
    );
  }
  if (!responseUrl) {
    throw new DriveAuthError(details.interactive ? "cancelled" : "signin");
  }
  return responseUrl;
}

async function requestToken(body: { [name: string]: string }) {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
  } catch (error) {
    throw new DriveAuthError("network", String(error));
  }
  const token: TokenResponse = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new DriveAuthError(
      token.error === "invalid_grant" ? "signin" : "network",
      token.error ?? String(response.status),
    );
  }
  return token;
}

function webAuthUrl(state: string, prompt: string, loginHint?: string) {
  return authUrl({
    client_id: WEB_CLIENT_ID,
    response_type: "token",
    redirect_uri: redirectUri("web"),
    scope: DRIVE_SCOPE,
    state,
    include_granted_scopes: "true",
    prompt,
    login_hint: loginHint,
  });
}

export async function signIn(
  client: DriveClient,
  loginHint?: string,
): Promise<SignInResult> {
  const state = randomString();
  if (client === "web") {
    const responseUrl = await launch({
      url: webAuthUrl(state, "select_account", loginHint),
      interactive: true,
    });
    return { session: toSession(parseRedirect(responseUrl, state)) };
  }

  const verifier = randomString();
  const redirect = redirectUri("desktop");
  const responseUrl = await launch({
    url: authUrl({
      client_id: DESKTOP_CLIENT_ID,
      response_type: "code",
      redirect_uri: redirect,
      scope: DRIVE_SCOPE,
      state,
      access_type: "offline",
      prompt: "select_account consent",
      code_challenge: await pkceChallenge(verifier),
      code_challenge_method: "S256",
      login_hint: loginHint,
    }),
    interactive: true,
  });
  const code = parseRedirect(responseUrl, state).get("code");
  if (!code) {
    throw new DriveAuthError("cancelled", "No authorization code.");
  }
  const token = await requestToken({
    client_id: DESKTOP_CLIENT_ID,
    client_secret: DESKTOP_CLIENT_SECRET,
    code,
    code_verifier: verifier,
    redirect_uri: redirect,
    grant_type: "authorization_code",
  });
  if (!token.refresh_token) {
    throw new DriveAuthError("signin", "No refresh token.");
  }
  return { session: toSession(token), refreshToken: token.refresh_token };
}

async function renewSession(record: DriveRecord) {
  if (record.client === "web") {
    const state = randomString();
    const responseUrl = await launch({
      url: webAuthUrl(state, "none", record.email),
      interactive: false,
      abortOnLoadForNonInteractive: false,
      timeoutMsForNonInteractive: SILENT_TIMEOUT,
    });
    return toSession(parseRedirect(responseUrl, state));
  }

  if (!record.refreshToken) {
    throw new DriveAuthError("signin", "No refresh token.");
  }
  try {
    return toSession(
      await requestToken({
        client_id: DESKTOP_CLIENT_ID,
        client_secret: DESKTOP_CLIENT_SECRET,
        refresh_token: record.refreshToken,
        grant_type: "refresh_token",
      }),
    );
  } catch (error) {
    if (error instanceof DriveAuthError && error.reason === "signin") {
      await updateDriveRecord((changed) => {
        delete changed.refreshToken;
        return changed;
      }, record.connectionId);
      const session = await readDriveSession();
      if (session?.connectionId === record.connectionId) {
        await writeDriveSession(null);
      }
    }
    throw error;
  }
}

export async function getAccessToken(
  record: DriveRecord,
  rejected?: string,
): Promise<string> {
  return await navigator.locks.request(DRIVE_AUTH_LOCK, async () => {
    const session = await readDriveSession();
    if (
      session &&
      session.connectionId === record.connectionId &&
      session.accessToken !== rejected &&
      session.expiresAt - Date.now() > RENEW_MARGIN
    ) {
      return session.accessToken;
    }
    const renewed = await renewSession(record);
    if ((await readDriveRecord())?.connectionId === record.connectionId) {
      await writeDriveSession({
        ...renewed,
        connectionId: record.connectionId,
      });
    }
    return renewed.accessToken;
  });
}

export async function revokeAccess(record: DriveRecord) {
  let token = record.refreshToken;
  if (!token) {
    try {
      token = await getAccessToken(record);
    } catch (error) {
      return (
        record.client === "desktop" &&
        error instanceof DriveAuthError &&
        error.reason === "signin"
      );
    }
  }
  try {
    const response = await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    if (response.ok) {
      return true;
    }
    const body: TokenResponse = await response.json().catch(() => ({}));
    return body.error === "invalid_token";
  } catch (error) {
    console.warn("Could not revoke the access.", error);
    return false;
  }
}

function requestLoopback() {
  try {
    return chrome.permissions
      .request({ ...DATA_COLLECTION_PERMISSION, ...LOOPBACK_PERMISSION })
      .catch(() => chrome.permissions.request(LOOPBACK_PERMISSION))
      .catch(() => false);
  } catch {
    return chrome.permissions.request(LOOPBACK_PERMISSION).catch(() => false);
  }
}

export function requestDataCollection() {
  if (!isFirefox) {
    return Promise.resolve(true);
  }
  if (!chrome.identity) {
    return requestLoopback();
  }
  try {
    return chrome.permissions
      .request(DATA_COLLECTION_PERMISSION)
      .catch(() => true);
  } catch {
    return Promise.resolve(true);
  }
}

export async function hasDataCollection(client: DriveClient) {
  if (client !== "desktop") {
    return true;
  }
  try {
    return await chrome.permissions.contains(DATA_COLLECTION_PERMISSION);
  } catch {
    return true;
  }
}
