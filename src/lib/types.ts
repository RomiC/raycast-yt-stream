/** How a stream is presented in the UI. */
export type StreamState = "live" | "recording" | "video";

/** Channel identifier as returned by the resolver: the ID is the key, the URL is derived. */
export interface Channel {
  id: string;
  name: string;
  /** YouTube channel ID (`UC…`). */
  channelId: string;
  thumbnail: string | null;
  /** Channel "About" text, as published by YouTube. */
  description: string | null;
  createdAt: number;
}

export interface Stream {
  videoId: string;
  title: string;
  channelId: string;
  channelName: string;
  thumbnail: string;
  state: StreamState;
  /** ISO 8601 timestamp from the feed entry. */
  publishedAt: string;
}

/** Normalized user preferences for talking to the yt-stream service. */
export interface ServiceConfig {
  /** Protocol + host + port only, without a trailing slash. */
  baseUrl: string;
  token: string;
}
