/** How a stream is presented in the UI. String values are stable, so records stay readable. */
export enum StreamState {
  Live = "live",
  Recording = "recording",
}

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
}

/** Normalized user preferences for talking to the yt-stream service. */
export interface ServiceConfig {
  /** Protocol + host + port only, without a trailing slash. */
  baseUrl: string;
  token: string;
}
