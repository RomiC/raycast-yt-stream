import { getPreferenceValues } from "@raycast/api";
import { UserError } from "./errors";
import type { ServiceConfig } from "./types";

const API_PATH = "/api/stream";
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const TIMEOUT_MS = 60_000;

export function getServiceConfig(): ServiceConfig {
  const { streamApiUrl, apiToken } = getPreferenceValues<Preferences>();
  if (!apiToken.trim()) {
    throw new UserError("validation", "Set your API token in the extension preferences.");
  }
  return { baseUrl: normalizeBaseUrl(streamApiUrl), token: apiToken.trim() };
}

/** Accepts protocol + host + port only; a path means the user pasted the full endpoint. */
export function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new UserError("validation", "The service URL must look like https://host:8443.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UserError("validation", "The service URL must start with https:// or http://.");
  }

  if (url.pathname !== "/" || url.search || url.hash) {
    throw new UserError("validation", "Enter the base URL only, without a path: protocol, host and port.");
  }

  return url.origin;
}

export async function startStream(videoId: string, config: ServiceConfig): Promise<void> {
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    throw new UserError("validation", "That item does not have a valid YouTube video ID.");
  }

  const endpoint = new URL(API_PATH, config.baseUrl);
  endpoint.searchParams.set("url", `https://youtu.be/${videoId}`);

  const response = await fetch(endpoint, {
    method: "GET",
    headers: { Authorization: `Bearer ${config.token}` },
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (response.status === 302) {
    return;
  }

  throw new UserError("api", `The service returned HTTP ${response.status} instead of 302.`, {
    status: response.status,
  });
}
