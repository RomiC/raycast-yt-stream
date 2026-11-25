import { LocalStorage } from "@raycast/api";
import { randomUUID } from "node:crypto";
import { UserError } from "./errors";
import type { Channel } from "./types";

const STORAGE_KEY = "channels";

export async function listChannels(): Promise<Channel[]> {
  const channels = await readAll();
  return channels.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export async function getChannel(id: string): Promise<Channel | undefined> {
  const channels = await readAll();
  return channels.find((channel) => channel.id === id);
}

export type NewChannel = Pick<Channel, "name" | "channelId"> & Partial<Pick<Channel, "thumbnail">>;

export async function insertChannel(channel: NewChannel): Promise<Channel> {
  const channels = await readAll();
  if (channels.some((existing) => existing.channelId === channel.channelId)) {
    throw new UserError("validation", "This channel is already in your list.");
  }

  const created: Channel = {
    id: randomUUID(),
    name: channel.name,
    channelId: channel.channelId,
    thumbnail: channel.thumbnail ?? null,
    createdAt: Date.now(),
  };

  await writeAll([...channels, created]);
  return created;
}

export type ChannelUpdate = Pick<Channel, "name" | "channelId"> & Partial<Pick<Channel, "thumbnail">>;

export async function updateChannel(id: string, update: ChannelUpdate): Promise<Channel> {
  const channels = await readAll();
  const index = channels.findIndex((channel) => channel.id === id);
  if (index === -1) {
    throw new UserError("unknown", "The channel no longer exists.");
  }

  const updated: Channel = {
    ...channels[index],
    name: update.name,
    channelId: update.channelId,
    thumbnail: update.thumbnail ?? null,
  };

  const next = [...channels];
  next[index] = updated;
  await writeAll(next);
  return updated;
}

export async function deleteChannel(id: string): Promise<void> {
  const channels = await readAll();
  await writeAll(channels.filter((channel) => channel.id !== id));
}

// Whole-list read-modify-write; our commands are short-lived, so lost updates are not a concern.
async function readAll(): Promise<Channel[]> {
  const raw = await LocalStorage.getItem<string>(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new UserError("parse", "Your channel list is unreadable and was left untouched.", { cause: error });
  }

  if (!Array.isArray(parsed) || !parsed.every(isChannel)) {
    throw new UserError("parse", "Your channel list has an unexpected format and was left untouched.");
  }

  return parsed;
}

async function writeAll(channels: Channel[]): Promise<void> {
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(channels));
}

function isChannel(value: unknown): value is Channel {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const channel = value as Record<string, unknown>;
  return (
    typeof channel.id === "string" &&
    typeof channel.name === "string" &&
    typeof channel.channelId === "string" &&
    typeof channel.createdAt === "number" &&
    (channel.thumbnail === null || typeof channel.thumbnail === "string")
  );
}
