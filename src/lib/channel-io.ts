import { environment } from "@raycast/api";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { UserError } from "./errors";
import type { Channel } from "./types";

/** The single record guard, shared by the store and by imports. */
export function isChannel(value: unknown): value is Channel {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const channel = value as Record<string, unknown>;
  return (
    typeof channel.id === "string" &&
    typeof channel.name === "string" &&
    typeof channel.channelId === "string" &&
    typeof channel.createdAt === "number" &&
    (channel.thumbnail === null || typeof channel.thumbnail === "string") &&
    (channel.description === null || channel.description === undefined || typeof channel.description === "string")
  );
}

export function serializeChannels(channels: Channel[]): string {
  return `${JSON.stringify(channels, null, 2)}\n`;
}

/**
 * Accepts a bare array or a `{ "channels": [...] }` wrapper. Validation is atomic: the first
 * invalid record rejects the whole payload, so a partial import can never be written.
 */
export function parseChannels(json: string): Channel[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new UserError("parse", "This file is not valid JSON.", { cause: error });
  }

  const list = Array.isArray(parsed) ? parsed : (parsed as { channels?: unknown })?.channels;
  if (!Array.isArray(list)) {
    throw new UserError("parse", 'Expected a list of channels, or an object with a "channels" array.');
  }

  return list.map((entry, index) => {
    if (!isChannel(entry)) {
      throw new UserError("validation", `Entry ${index + 1} is not a valid channel record.`);
    }
    return { ...entry, description: entry.description ?? null };
  });
}

export type MergeResult = { merged: Channel[]; imported: number; skipped: number };

/**
 * De-duplicates by `channelId` and gives every accepted record a fresh local `id`, so an edited or
 * copied file cannot collide with an existing row (delete and rename match on `id`).
 */
export function mergeChannels(existing: Channel[], incoming: Channel[]): MergeResult {
  const known = new Set(existing.map((channel) => channel.channelId));
  const merged = [...existing];
  let imported = 0;
  let skipped = 0;

  for (const channel of incoming) {
    if (known.has(channel.channelId)) {
      skipped += 1;
      continue;
    }
    known.add(channel.channelId);
    merged.push({ ...channel, id: randomUUID() });
    imported += 1;
  }

  return { merged, imported, skipped };
}

/** Writes a dated export into the extension's support folder and returns its path. */
export async function exportChannelsToFile(channels: Channel[]): Promise<string> {
  const directory = join(environment.supportPath, "exports");
  await mkdir(directory, { recursive: true });

  const stamp = new Date().toISOString().slice(0, 10);
  const file = join(directory, `channels-${stamp}.json`);
  await writeFile(file, serializeChannels(channels), "utf8");
  return file;
}
