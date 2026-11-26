import { UserError } from "./errors";
import { decodeEntities } from "./text";
import type { Channel, Stream, StreamState } from "./types";

const FEED_ORIGIN = "https://www.youtube.com/feeds/videos.xml";
const REQUEST_TIMEOUT_MS = 20_000;
// RSS carries no live flag, so very recent entries are treated as live. `recording` is not detectable.
const LIVE_WINDOW_MS = 3 * 60 * 60 * 1000;

export async function fetchStreams(channel: Channel): Promise<Stream[]> {
  const feedUrl = new URL(FEED_ORIGIN);
  feedUrl.searchParams.set("channel_id", channel.channelId);

  let response: Response;
  try {
    response = await fetch(feedUrl, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw new UserError("network", `Could not load streams for ${channel.name}. Check your connection.`, {
      cause: error,
    });
  }

  if (!response.ok) {
    throw new UserError("network", `YouTube returned HTTP ${response.status} for ${channel.name}.`, {
      status: response.status,
    });
  }

  return parseFeed(await response.text(), channel);
}

export function parseFeed(xml: string, channel: Channel, now = Date.now()): Stream[] {
  const entries = xml.split("<entry>").slice(1);
  const streams: Stream[] = [];

  for (const entry of entries) {
    const videoId = tagText(entry, "yt:videoId");
    const title = tagText(entry, "title");
    if (!videoId || !title) {
      continue;
    }

    const publishedAt = tagText(entry, "published") ?? "";
    streams.push({
      videoId,
      title: decodeEntities(title),
      channelId: channel.channelId,
      channelName: channel.name,
      thumbnail: tagThumbnail(entry) ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      state: deriveState(publishedAt, now),
      publishedAt,
    });
  }

  return streams.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

function tagText(entry: string, tag: string): string | undefined {
  return entry.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1]?.trim();
}

function tagThumbnail(entry: string): string | undefined {
  return entry.match(/<media:thumbnail url="([^"]+)"/)?.[1];
}

function deriveState(publishedAt: string, now: number): StreamState {
  const published = Date.parse(publishedAt);
  if (!Number.isFinite(published)) {
    return "video";
  }
  return now - published <= LIVE_WINDOW_MS ? "live" : "video";
}
