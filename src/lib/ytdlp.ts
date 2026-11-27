import { environment } from "@raycast/api";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { chmod, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { channelPageUrl } from "./channel-resolver";
import { UserError } from "./errors";
import { StreamState, type Channel, type Stream } from "./types";

const run = promisify(execFile);

const RELEASE_BASE = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";
const ASSET = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp_macos";
const PLAYLIST_LIMIT = 20;
const INSTALL_TIMEOUT_MS = 60_000;
const EXEC_TIMEOUT_MS = 60_000;
const MAX_BUFFER = 64 * 1024 * 1024;

export type DownloadProgress = { received: number; total: number };

function localBinaryPath(): string {
  return join(environment.supportPath, "bin", ASSET);
}

let systemBinary: boolean | undefined;

async function hasSystemYtDlp(): Promise<boolean> {
  if (systemBinary === undefined) {
    systemBinary = await run("yt-dlp", ["--version"], { timeout: 10_000 }).then(
      () => true,
      () => false,
    );
  }
  return systemBinary;
}

/** True when a usable yt-dlp already exists, so the setup screen can be skipped. */
export async function isYtDlpReady(): Promise<boolean> {
  return (await hasSystemYtDlp()) || existsSync(localBinaryPath());
}

/** Never downloads on its own: the user must approve the download from the setup screen. */
async function resolveYtDlp(): Promise<string> {
  if (await hasSystemYtDlp()) {
    return "yt-dlp";
  }

  const local = localBinaryPath();
  if (existsSync(local)) {
    return local;
  }

  throw new UserError("validation", "yt-dlp is not installed yet. Open Browse Streams to download it.");
}

let installing: Promise<string> | undefined;

/** User-triggered install; reports bytes so the UI can show progress. */
export function installYtDlp(onProgress?: (progress: DownloadProgress) => void): Promise<string> {
  installing ??= downloadYtDlp(onProgress).catch((error) => {
    installing = undefined;
    throw error;
  });
  return installing;
}

async function downloadYtDlp(onProgress?: (progress: DownloadProgress) => void): Promise<string> {
  const binaryPath = localBinaryPath();
  if (existsSync(binaryPath)) {
    return binaryPath;
  }

  const partialPath = `${binaryPath}.download`;
  try {
    await mkdir(join(environment.supportPath, "bin"), { recursive: true });
    const expected = await expectedChecksum(ASSET);
    const actual = await download(`${RELEASE_BASE}/${ASSET}`, partialPath, onProgress);
    if (actual !== expected) {
      throw new Error(`Checksum mismatch: expected ${expected}, got ${actual}`);
    }
    await chmod(partialPath, 0o755);
    await rename(partialPath, binaryPath);
    return binaryPath;
  } catch (error) {
    await rm(partialPath, { force: true });
    throw new UserError("network", "Could not download yt-dlp. Install it manually or check your connection.", {
      cause: error,
    });
  }
}

async function expectedChecksum(asset: string): Promise<string> {
  const response = await fetch(`${RELEASE_BASE}/SHA2-256SUMS`, { signal: AbortSignal.timeout(INSTALL_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Checksum list returned HTTP ${response.status}`);
  }

  const line = (await response.text())
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.endsWith(` ${asset}`) || entry.endsWith(`*${asset}`));
  if (!line) {
    throw new Error(`No checksum published for ${asset}`);
  }
  return line.split(/\s+/)[0];
}

/** Streams the download to disk while hashing it, so the file is verified before it is used. */
async function download(
  url: string,
  destination: string,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(INSTALL_TIMEOUT_MS) });
  if (!response.ok || !response.body) {
    throw new Error(`Download returned HTTP ${response.status}`);
  }

  const total = Number(response.headers.get("content-length")) || 0;
  const hash = createHash("sha256");
  let received = 0;
  const hasher = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      received += chunk.length;
      onProgress?.({ received, total });
      callback(null, chunk);
    },
  });

  await pipeline(Readable.fromWeb(response.body as NodeReadableStream), hasher, createWriteStream(destination));
  return hash.digest("hex");
}

/** Streams for one channel, as reported by yt-dlp's flat playlist mode. */
export async function fetchStreams(channel: Channel): Promise<Stream[]> {
  const binary = await resolveYtDlp();
  const url = `${channelPageUrl(channel.channelId)}/streams`;

  let stdout: string;
  try {
    ({ stdout } = await run(binary, ["--flat-playlist", "--dump-json", "--playlist-end", String(PLAYLIST_LIMIT), url], {
      maxBuffer: MAX_BUFFER,
      timeout: EXEC_TIMEOUT_MS,
    }));
  } catch (error) {
    throw new UserError("network", `Could not load streams for ${channel.name}.`, { cause: error });
  }

  return parseStreams(stdout, channel);
}

export function parseStreams(output: string, channel: Channel): Stream[] {
  const streams: Stream[] = [];

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let entry: { id?: unknown; title?: unknown; live_status?: unknown };
    try {
      entry = JSON.parse(trimmed) as typeof entry;
    } catch {
      continue;
    }

    if (typeof entry.id !== "string" || typeof entry.title !== "string") {
      continue;
    }

    streams.push({
      videoId: entry.id,
      title: entry.title,
      channelId: channel.channelId,
      channelName: channel.name,
      thumbnail: `https://i.ytimg.com/vi/${entry.id}/mqdefault.jpg`,
      state: entry.live_status === "is_live" ? StreamState.Live : StreamState.Recording,
    });
  }

  // yt-dlp already lists live streams first; this keeps that order explicit and stable.
  return streams.sort((a, b) => Number(b.state === StreamState.Live) - Number(a.state === StreamState.Live));
}
