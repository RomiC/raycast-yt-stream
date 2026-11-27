import { LocalStorage } from "@raycast/api";
import { randomUUID } from "node:crypto";
import { isChannel, mergeChannels } from "./channel-io";
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

export type NewChannel = Pick<Channel, "name" | "channelId"> & Partial<Pick<Channel, "thumbnail" | "description">>;

export async function insertChannel(channel: NewChannel): Promise<Channel> {
  const name = channel.name.trim();
  if (!name) {
    throw new UserError("validation", "Enter a channel name.");
  }

  const channels = await readAll();
  if (channels.some((existing) => existing.channelId === channel.channelId)) {
    throw new UserError("validation", "This channel is already in your list.");
  }

  const created: Channel = {
    id: randomUUID(),
    name,
    channelId: channel.channelId,
    thumbnail: channel.thumbnail ?? null,
    description: channel.description ?? null,
    createdAt: Date.now(),
  };

  await writeAll([...channels, created]);
  return created;
}

/** Only the display name is user-editable; the channel identity and avatar come from YouTube. */
export async function renameChannel(id: string, name: string): Promise<Channel> {
  const channels = await readAll();
  const index = channels.findIndex((channel) => channel.id === id);
  if (index === -1) {
    throw new UserError("unknown", "The channel no longer exists.");
  }

  const trimmed = name.trim();
  if (!trimmed) {
    throw new UserError("validation", "Enter a channel name.");
  }

  const updated: Channel = { ...channels[index], name: trimmed };
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

  // Records written before `description` existed are normalised instead of rejected.
  return parsed.map((channel) => ({ ...channel, description: channel.description ?? null }));
}

async function writeAll(channels: Channel[]): Promise<void> {
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(channels));
}

/** Bulk merge as a single read-modify-write, so N records do not cause N writes. */
export async function importChannels(records: Channel[]): Promise<{ imported: number; skipped: number }> {
  const channels = await readAll();
  const { merged, imported, skipped } = mergeChannels(channels, records);
  if (imported > 0) {
    await writeAll(merged);
  }
  return { imported, skipped };
}
