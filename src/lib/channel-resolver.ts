import { UserError } from "./errors";
import { decodeEntities } from "./text";

const YOUTUBE_ORIGIN = "https://www.youtube.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 20_000;
// "Channels" search filter, so a bare name does not resolve to a video.
const CHANNEL_SEARCH_FILTER = "EgIQAg%3D%3D";
// YouTube sometimes serves a results page without channel entries, so search retries a few times.
const SEARCH_ATTEMPTS = 3;

/** Canonical channel page; the only supported URL form, derived from the channel ID. */
export function channelPageUrl(channelId: string): string {
  return `https://www.youtube.com/channel/${channelId}`;
}

export type ResolvedChannel = {
  name: string;
  channelId: string;
  thumbnail: string | null;
  description: string | null;
};

export async function resolveChannel(input: string, options?: { signal?: AbortSignal }): Promise<ResolvedChannel> {
  const { signal } = options ?? {};
  const trimmed = input.trim();
  if (!trimmed) {
    throw new UserError("validation", "Enter a channel URL, an @handle or a channel name.");
  }

  const direct = toChannelUrl(trimmed);
  if (direct) {
    return fetchChannel(direct, signal);
  }

  if (/^https?:\/\//i.test(trimmed) || /youtube\.com/i.test(trimmed)) {
    throw new UserError(
      "validation",
      "That link is not a YouTube channel. Paste a channel URL such as https://www.youtube.com/@LofiGirl.",
    );
  }

  return fetchChannel(await searchChannel(trimmed, signal), signal);
}

/** Maps a pasted channel URL, `@handle` or `UC…` ID to a channel page URL; other links yield null. */
export function toChannelUrl(input: string): string | null {
  if (input.startsWith("@")) {
    return `${YOUTUBE_ORIGIN}/${input}`;
  }

  if (/^UC[\w-]{22}$/.test(input)) {
    return `${YOUTUBE_ORIGIN}/channel/${input}`;
  }

  if (!/youtube\.com\//i.test(input)) {
    return null;
  }

  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const [first, second] = parts;

  if (first?.startsWith("@")) {
    return `${YOUTUBE_ORIGIN}/${first}`;
  }

  switch (first) {
    case "channel":
      return second && /^UC[\w-]{22}$/.test(second) ? `${YOUTUBE_ORIGIN}/channel/${second}` : null;
    case "user":
    case "c":
      return second ? `${YOUTUBE_ORIGIN}/${first}/${second}` : null;
    default:
      return null;
  }
}

async function searchChannel(name: string, signal: AbortSignal | undefined): Promise<string> {
  let sawResultsPage = false;

  for (let attempt = 0; attempt < SEARCH_ATTEMPTS; attempt += 1) {
    const url = new URL(`${YOUTUBE_ORIGIN}/results`);
    url.searchParams.set("search_query", name);
    url.searchParams.set("sp", CHANNEL_SEARCH_FILTER);

    const html = await fetchHtml(url.toString(), signal);
    const data = html.match(/var ytInitialData = (\{.*?\});<\/script>/s)?.[1];
    if (!data) {
      continue;
    }

    sawResultsPage = true;
    const found = findChannelResult(JSON.parse(data));
    if (found) {
      return new URL(found, YOUTUBE_ORIGIN).toString();
    }
  }

  throw sawResultsPage
    ? new UserError("validation", `No channel found for "${name}". Try pasting the channel URL instead.`)
    : new UserError("parse", "YouTube did not return search results. Try pasting the channel URL instead.");
}

async function fetchChannel(pageUrl: string, signal: AbortSignal | undefined): Promise<ResolvedChannel> {
  const html = await fetchHtml(pageUrl, signal);

  const channelId =
    html.match(/feeds\/videos\.xml\?channel_id=([\w-]+)/)?.[1] ??
    html.match(/<link rel="canonical" href="[^"]*\/channel\/(UC[\w-]+)"/)?.[1];
  const title = html.match(/<meta property="og:title" content="([^"]*)"/)?.[1];
  const image = html.match(/<meta property="og:image" content="([^"]*)"/)?.[1];

  if (!channelId || !title) {
    throw new UserError("parse", "Could not read the channel details from YouTube. Check the URL and try again.");
  }

  return {
    name: decodeEntities(title),
    channelId,
    thumbnail: image ? decodeEntities(image) : null,
    description: readDescription(html),
  };
}

/** ytInitialData holds the full text; the og tag is a truncated fallback. */
function readDescription(html: string): string | null {
  const data = html.match(/var ytInitialData = (\{.*?\});<\/script>/s)?.[1];
  if (data) {
    try {
      const metadata = JSON.parse(data) as { metadata?: { channelMetadataRenderer?: { description?: unknown } } };
      const description = metadata.metadata?.channelMetadataRenderer?.description;
      if (typeof description === "string" && description.trim()) {
        return description.trim();
      }
    } catch {
      // Malformed page: fall back to the meta tag below.
    }
  }

  const fallback = html.match(/<meta property="og:description" content="([^"]*)"/)?.[1];
  return fallback ? decodeEntities(fallback).trim() : null;
}

async function fetchHtml(url: string, external?: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, "accept-language": "en-US,en;q=0.9" },
      signal: external ? AbortSignal.any([timeout, external]) : timeout,
    });
  } catch (error) {
    // A caller-side cancellation is not a failure: let it propagate so the caller can drop it.
    if (external?.aborted) {
      throw error;
    }
    throw new UserError("network", "Could not reach YouTube. Check your connection and try again.", { cause: error });
  }

  if (response.status === 404) {
    throw new UserError("validation", "That channel does not exist. Check the URL or handle.");
  }
  if (!response.ok) {
    throw new UserError("network", `YouTube responded with HTTP ${response.status}.`, { status: response.status });
  }

  return response.text();
}

/** Depth-first search of ytInitialData for the first channel result. */
function findChannelResult(node: unknown): string | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findChannelResult(item);
      if (found) {
        return found;
      }
    }
    return null;
  }

  if (typeof node !== "object" || node === null) {
    return null;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key.endsWith("Renderer") && typeof value === "object" && value !== null) {
      const renderer = value as {
        channelId?: unknown;
        navigationEndpoint?: { browseEndpoint?: { canonicalBaseUrl?: unknown } };
      };
      if (typeof renderer.channelId === "string") {
        const base = renderer.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl;
        return typeof base === "string" ? base : `/channel/${renderer.channelId}`;
      }
    }

    const nested = findChannelResult(value);
    if (nested) {
      return nested;
    }
  }

  return null;
}
