# YouTube Stream — Implementation Plan

Each work item (WI) is a small, independently reviewable slice. Items are ordered so that every slice builds on working, already-reviewed code. After each WI the extension still compiles (`npm run build` / `npx ray build`).

## Work items at a glance

| #     | Title                                             | Depends on | Size |
| ----- | ------------------------------------------------- | ---------- | ---- |
| WI-1  | Extension skeleton & preferences                  | —          | S    |
| WI-2  | Domain types & error helpers                      | —          | S    |
| WI-3  | Channel store (`channels.ts`)                     | WI-2       | S    |
| WI-4  | Stream API client (`api.ts`)                      | WI-2       | S    |
| WI-5  | Channel resolver (`channel-resolver.ts`)          | WI-2       | M    |
| WI-6  | yt-dlp stream fetcher (`ytdlp.ts`)                | WI-2, WI-5 | M    |
| WI-7  | Channel form (add & rename)                       | WI-3, WI-5 | M    |
| WI-8  | Manage Channels command                           | WI-3, WI-7 | M    |
| WI-9  | Browse Streams — list rendering                   | WI-3, WI-6 | L    |
| WI-10 | Browse Streams — filters                          | WI-9       | S    |
| WI-11 | Browse Streams — actions                          | WI-4, WI-9 | M    |
| WI-12 | Polish & harden                                   | all        | M    |
| WI-13 | Channel IO library (`channel-io.ts`)              | WI-3       | S    |
| WI-14 | Export action on Manage Channels                  | WI-13      | S    |
| WI-15 | Import form on Manage Channels                    | WI-13      | M    |
| WI-16 | yt-dlp setup screen                               | WI-6       | S    |

WI-4, WI-5, WI-6 are independent of each other and can be done in parallel once WI-2 exists. WI-13 to WI-15 are independent of the stream work and can be done at any point after WI-3.

---

## WI-1 — Extension skeleton & preferences

**Files:** `package.json`, `src/index.tsx`, `src/manage-channels.tsx`

- Register two `view` commands in `package.json`:
  - `index` → "Browse Streams"
  - `manage-channels` → "Manage Channels"
- Add two preferences:
  - `streamApiUrl` — `textfield`, required, **no default**, title/hint noting "protocol + host + port only".
  - `apiToken` — `password`, required.
- Create minimal placeholder views (two `List`s) so every command opens.

**Done when:** `npm run dev` opens both commands; preferences show with no default and the token masked; `npm run build` passes.

---

## WI-2 — Domain types & error helpers

**Files:** `src/lib/types.ts`, `src/lib/errors.ts`

- `types.ts`: `Channel`, `Stream`, the `StreamState` enum (`Live = "live"`, `Recording = "recording"`) and a `ServiceConfig` type mirroring the package.json preferences.
- `errors.ts`: a `UserError` (message-safe, never carries the token) and a mapper that turns raw failures (network / parse / validation) into user-facing messages.

**Done when:** typecheck passes; the types match §4 and §5.3 of the design doc.

---

## WI-3 — Channel store (`channels.ts`)

**Files:** `src/lib/channels.ts`

- Store the channel list in `LocalStorage` under one key as a JSON array.
- Validate every record shape on read; raise a `UserError` and leave data untouched if unparseable.
- Implement `listChannels`, `getChannel`, `insertChannel`, `renameChannel`, `deleteChannel`, enforcing `channelId` uniqueness on insert.

**Done when:** code review of the CRUD and validation; add/list round-trips persist across launches.

---

## WI-4 — Stream API client (`api.ts`)

**Files:** `src/lib/api.ts`

- `startStream(videoId, config: ServiceConfig)`:
  - validate `videoId` against `^[A-Za-z0-9_-]{11}$`;
  - build `{baseUrl}/api/stream?url=https://youtu.be/<id>`;
  - `fetch` with `Authorization: Bearer <token>`, `redirect: "manual"`, 60 s `AbortSignal.timeout`;
  - resolve on `302`, throw a typed error (with status code) otherwise.
- Token never appears in arguments, thrown messages, or logs.

**Done when:** code review; manual test against the real service returns success for a known ID.

---

## WI-5 — Channel resolver (`channel-resolver.ts`)

**Files:** `src/lib/channel-resolver.ts`

- `resolveChannel(input): Promise<ResolvedChannel>` accepts a channel URL, `@handle`, `UC…` ID or bare name, and returns `{ name, channelId, thumbnail, description }`.
- `toChannelUrl` normalizes `@handle`, `/channel/UC…`, `/user/…`, `/c/…` and any extra path segment (`/streams`, `/videos`) to a channel page URL, and returns `null` for non-channel links.
- Links that are not channels (a video, the YouTube home page) are rejected with a validation error instead of being searched for.
- Fetch the channel page and extract name (`og:title`), avatar (`og:image`), `channelId` (the page's `feeds/videos.xml` link, falling back to `link rel="canonical"`) and the About text (`ytInitialData` → `channelMetadataRenderer.description`, falling back to `og:description`).
- Always return the canonical `channelId`; the page URL is derived with `channelPageUrl(channelId)` instead of being stored, so renames and URL forms cannot create duplicates.
- Bare names use YouTube search with the Channels filter and take the first result. That page intermittently omits channel entries, so search retries (3 attempts) before failing.
- Errors are typed: `validation` (not a channel, not found, no search match), `parse` (unexpected page), `network` (unreachable, non-2xx).

**Done when:** `@handle`, `channel/UC…`, `user/…` and bare-name inputs all resolve to the same canonical record; a dead handle, a video link and an unmatched name each produce a clear message.

---

## WI-6 — yt-dlp stream fetcher (`ytdlp.ts`)

**Files:** `src/lib/ytdlp.ts`

- `isYtDlpReady()` / `resolveYtDlp()`: detect a `yt-dlp` on `PATH` (cached) or a previously installed copy under `<supportPath>/bin/`. Fetching never downloads: without a binary it raises a `validation` error that points at the setup screen.
- `installYtDlp(onProgress)`: user-triggered install of the platform asset from the latest GitHub release into `<supportPath>/bin/`, streamed to disk while hashing, verified against the release `SHA2-256SUMS`, `chmod 755`ed and renamed into place. Failures clean up and raise a `network` error.
- `fetchStreams(channel)`: runs `yt-dlp --flat-playlist --dump-json --playlist-end 20 <channel>/streams` with a 60 s timeout, parses the JSONL, and retries the run once before reporting a `network` error.
- `parseStreams(output, channel)`: maps `{ id, title, live_status }` to `Stream`, treats `is_live` as `Live` and everything else as `Recording`, builds the 16:9 `mqdefault` thumbnail, and keeps live entries first.

**Done when:** a channel with running lives returns them as `Live` with real titles and thumbnails; a channel with only past streams returns them as `Recording`; a second run reuses an existing binary.

---

## WI-7 — Channel form (add & rename)

**Files:** `src/components/add-edit-channel-form.tsx`

- One component for both modes, pushed by Manage Channels (and by the Browse Streams empty state once WI-9 lands); there is no standalone add command.
- Add mode has a single Channel field, closed by a `Form.Separator`; its `info` warns to use the full channel URL when a name search picks the wrong channel. A **debounced lookup (0.8 s)** runs while typing, then the Title (editable) and Description (read-only) appear.
- Rename mode shows the stored Title only; the description is not repeated there.
- Lookups are non-blocking: `Form.isLoading` renders a loading bar only, so the inputs stay usable while the request runs.
- The channel avatar is shown as the submit action's icon, since Raycast forms cannot render images. Channel ID and URL are not surfaced in the form.
- Resolver and store failures are caught (since `handleSubmit` does not catch), pinned to the field with `setValidationError`, toasted, and `return false` gives Raycast's failure feedback.
- Success shows `Added <name>` (or `Renamed to <name>`) and pops, so a pushed form returns to its caller.

**Done when:** typing a name or URL finds the channel and fills the title and description; editing the title is respected; changing the text re-searches; an unknown channel and a duplicate each show a field-level error and change nothing.

---

## WI-8 — Manage Channels command

**Files:** `src/manage-channels.tsx`, `src/lib/channels.ts`

- List channels from local storage with `usePromise(listChannels)`: avatar and title per row, plus the built-in search. No URL in the row.
- **Edit** pushes `AddEditChannelForm` in rename mode: the title is editable, channel ID and avatar are read-only; **Add Channel** pushes it in add mode; **Open in Browser** uses `channelPageUrl`.
- Pushed forms pass `revalidate` as the `onPop` callback, so the list refreshes whenever a form closes.
- **Remove** confirms with `confirmAlert` (destructive primary action), then deletes and revalidates.
- `renameChannel` touches only the name, so editing can never change or duplicate the channel identity.

**Done when:** add, rename, open and remove all work from one list; renaming leaves the channel ID and avatar intact; the list reflects every change without a relaunch.

---

## WI-9 — Browse Streams — list rendering

**Files:** `src/index.tsx`

- Load channels from local storage, then `fetchStreams` for each in parallel with `Promise.allSettled`, so one broken channel cannot blank the screen. The hook is `useCachedPromise`, so the previous result renders instantly while a background refresh replaces it.
- Render one combined `Grid` (3 columns, 16:9, `fit: fill`, `inset: zero` so the cover fills the cell); each `Grid.Item` shows the cover art as content, the stream title, the channel name as subtitle, and the state as an icon accessory with a `LIVE` / `RECORDING` tooltip (`Grid` has no coloured tag accessory).
- Sort with `useFrecencySorting` keyed on the video ID; unvisited streams keep `Live` before `Recording` in yt-dlp's order. Record a visit when a stream is opened.
- Empty states: no channels → prompt plus **Add Channel** (pushes `AddEditChannelForm` and revalidates on pop); channels but no streams → **Refresh** / **Add Channel**.
- A failed channel is reported once via `useCachedPromise`'s `onData` toast, stating that the other channels are still shown. `onData` fires on promise resolution only, so cached data does not re-raise old failures.
- Actions at this stage: **Open in Browser**, **Refresh** (`Keyboard.Shortcut.Common.Refresh`) and **Add Channel**. Starting a stream arrives in WI-11.

**Done when:** with one or more channels added, streams render with cover art, badges and correct ordering; a broken channel only produces a toast; with zero channels the empty state offers to add one.

---

## WI-10 — Browse Streams — filters

**Files:** `src/index.tsx`

- One `Grid.Dropdown` encoding `state|channelId`, since `searchBarAccessory` holds a single element and opens with `⌘ P`.
- Three groups of options: **All Streams**; **Channels** (one entry per channel, all states); **By State** (`Live`, `Recordings`, only states present in the data).
- Grouping depends on the filter: no channel selected → group by channel; a channel selected → group by state. Both dimensions are therefore always visible, and first-appearance order keeps the frecency/live ordering.
- Each `Grid.Item` gets `keywords` with its channel name and state, so text search matches beyond the title.
- Empty result → dedicated empty state with **Show All Streams**.

**Done when:** the three groups filter correctly, the grid groups by the complementary dimension, and a filter with no matches offers a way back.

---

## WI-11 — Browse Streams — actions

**Files:** `src/index.tsx`

- **Start Stream** is the primary action (Enter): reads preferences via `getServiceConfig`, calls `startStream`, and flips a single animated toast to success or failure.
- Failures use `toUserMessage(error, [token])`, so the bearer token can never leak into a toast even if an error message contained it.
- Starting or opening a stream records a frecency visit.
- Secondary actions: **Open in Browser** and **Copy URL** on `Keyboard.Shortcut.Common.Copy` (⌘⇧C / Ctrl+Shift+C), so the binding stays correct per platform.
- The window is not closed on success, so several streams can be started in a row; the grid shows its progress bar while a request is in flight.

**Done when:** pressing Enter on a live stream starts it on the service and confirms with a toast; a non-302 response produces a failure toast with the status code and no token; the invalid-ID case is rejected before any request.

---

## WI-12 — Polish & harden

**Files:** `src/index.tsx`, `src/manage-channels.tsx`, `src/lib/*`

- `fetchStreams` retries a failed yt-dlp run once before surfacing a `network` error.
- Empty states in Browse Streams offer **Add Channel** and **Manage Channels**, so import/export is reachable from the streaming screen. The yt-dlp setup stays exclusively on Browse Streams — Manage Channels never mentions it.
- Copy pass for consistent wording across both commands ("Could not load your …", "No … yet").
- Token audit: `apiToken` is read only by `getServiceConfig`, sent only as an `Authorization` header, never logged, and redacted through `toUserMessage(error, [token])` on the one path that holds it.
- Final pass: `npm run lint`, `npm run build`, Prettier.

**Done when:** a transient yt-dlp failure does not immediately surface as a channel error, every empty state leads somewhere useful, and no token can reach a log, toast or error message.

---

## WI-13 — Channel IO library (`channel-io.ts`)

**Files:** `src/lib/channel-io.ts`, `src/lib/channels.ts`

- `serializeChannels(): Promise<string>` — pretty-printed JSON array of stored records (DESIGN §6.4).
- `parseChannels(json: string): Channel[]` — accepts a bare array or `{ "channels": [...] }`, validates every record with `isChannel` (now shared from `channel-io.ts`, which the store imports too), and rejects the whole payload on the first invalid entry (atomic). Records without `description` are normalised to `null`.
- `mergeChannels(existing, incoming)` — de-duplicates by `channelId`, never overwrites an existing record, and reports `{ merged, imported, skipped }`.
- `importChannels(records)` in `channels.ts` performs the merge as a single read-modify-write, and writes only when something was imported.

**Done when:** code review; `serialize → parse → merge` round-trips losslessly and the atomic rejection path is covered.

---

## WI-14 — Export Channels command

**Files:** `src/manage-channels.tsx`, `src/lib/channel-io.ts`

- An **Export Channels** action on Manage Channels calls `exportChannelsToFile`, which writes `<supportPath>/exports/channels-<YYYY-MM-DD>.json` (creating the `exports` directory if missing).
- Reveal the file with `showInFinder` and toast "Exported N channels". No clipboard path.
- Empty list → toast "Nothing to export" and no file written.

**Done when:** the written file imports back unchanged through WI-15 and opens from Finder.

---

## WI-15 — Import Channels command

**Files:** `src/components/import-channels-form.tsx`, `src/manage-channels.tsx`

- An **Import Channels** action pushes `ImportChannelsForm`: a `Form` with one required `Form.FilePicker` limited to `.json`, single selection. No paste path.
- Read the chosen file, then `parseChannels` and `importChannels` (WI-13).
- Report "Imported N, skipped M duplicates"; surface `UserError` messages as failure toasts with nothing written.
- Pop back to the channel list after a successful import and revalidate it.

**Done when:** importing an export merges correctly, re-importing the same file reports 0 imported with all duplicates skipped, and invalid JSON changes nothing.

---

## WI-16 — yt-dlp setup screen

**Files:** `src/components/ytdlp-install.tsx`, `src/index.tsx`

- A `Detail` view explaining what yt-dlp is, the GitHub release source, the `SHA2-256SUMS` verification, the ~37 MB size and that an existing system binary is used instead.
- **Download Now** starts `installYtDlp` and renders progress from the byte counter: `Downloading… 42% (15.4 MB of 36.0 MB)`.
- Entry point: Browse Streams renders the setup screen directly (instead of the grid) when channels exist but the binary is missing, and revalidates itself on success. Manage Channels stays free of setup UI.
- Fetching never triggers a download, so consent is always explicit.

**Done when:** with yt-dlp absent, Browse Streams points at the setup screen instead of failing silently; the download shows moving progress, verifies, and leaves the app usable afterwards.

---

## Review checklist (every WI)

- [ ] TypeScript compiles (`npm run build`).
- [ ] No token in logs, toasts, or error messages.
- [ ] Code matches the design doc sections referenced in the WI.
- [ ] For UI WIs: the change is manually exercised in `npm run dev`.
