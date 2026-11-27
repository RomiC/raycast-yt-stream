# YouTube Stream — Raycast Extension Design

## 1. Purpose

Let the user listen to their favourite YouTube live streams on any device that supports simple online streams.

1. Lists the user's favourite YouTube channels.
2. Lets the user pick a live stream from them.
3. Starts the selected stream on the `yt-stream` service by calling its HTTP API.

The extension is local-first, but the architecture keeps a future Raycast Store release possible.

> **Responsibility boundary.** The extension only asks the `yt-stream` service to start a given stream. It does not choose speakers, route audio, or control playback — the service owns that.

---

## 2. List of requirements

The plugin should do the following things:

| #   | Requirement                                                                            |
| --- | -------------------------------------------------------------------------------------- |
| 1   | Show streams from all added channels in a single view.                                 |
| 2   | Show cover art, title, channel, and state badge for every stream.                      |
| 3   | Filter the grid by channel and by state (`Live` / `Recording`).                        |
| 4   | Start the selected stream on the service on Enter (direct, no confirmation).           |
| 5   | Add a channel by pasting a URL or a channel name; fetch its details automatically.     |
| 6   | Persist channels locally; start empty and let the user fill it.                        |
| 7   | Export the channel list to a JSON file and import it back, on this or another machine. |

The service signals success with HTTP 302 and does not expect the client to follow it. `fetch` follows redirects by default, so the client must set `redirect: "manual"` to observe the 302.

---

## 3. Goals & non-goals

### Goals (v1)

- A native single-screen Raycast UI (no multi-step channel → stream navigation).
- Configurable `yt-stream` service endpoint and API token.
- Fetch streams with yt-dlp, so `Live` is exact — no YouTube API key required.
- Persist channels with Raycast `LocalStorage`.
- Keep the token out of process arguments, logs, and error messages.

### Non-goals (v1)

- No YouTube search beyond resolving a pasted channel URL/name.
- No scheduling, favourites, or per-device control.
- No YouTube API key and no OAuth; yt-dlp is the only external dependency.
- No store submission polish; store-readiness is a constraint, not a deliverable.

---

## 4. Configuration & persistence

### 4.1 Raycast preferences (`package.json` → `preferences`)

| Key            | Type        | Required | Default | Notes                                                                                                   |
| -------------- | ----------- | -------- | ------- | ------------------------------------------------------------------------------------------------------- |
| `streamApiUrl` | `textfield` | yes      | —       | `yt-stream` service base URL — protocol + host + port only (e.g. `https://yt-stream.example.com:8443`). |
| `apiToken`     | `password`  | yes      | —       | Bearer token. Stored by Raycast in the macOS Keychain.                                                  |

The token is passed to the extension as a preference value, never written to argv or logs.

### 4.2 Channel storage — `LocalStorage`

Channels are stored with Raycast's `LocalStorage` API under a single key (`channels`), holding a JSON array of channel records. No database file, no runtime dependency, no schema to migrate.

Record shape:

```json
{
  "id": "uuid",
  "name": "Lofi Girl",
  "channelId": "UCSJ4gkVC6NrvII8umztf0Ow",
  "thumbnail": "https://…",
  "description": "Channel About text…",
  "createdAt": 1731000000000
}
```

`channelId` is the natural key and the only identifier stored. The channel page URL is never persisted — it is derived with `channelPageUrl(channelId)`, so it cannot disagree with the ID.

- The list starts **empty**; the user adds channels themselves.
- Every read validates the record shape before use. Unparseable or unexpected data raises a `UserError` and is **left untouched** rather than silently overwritten. A record without `description` (written by an earlier build) is normalised to `null` instead of being rejected.
- Channel uniqueness is enforced in code, by `channelId`.
- Writes are whole-list read-modify-write. Acceptable because the list is small and commands are short-lived; this is the known limit of the approach.

---

## 5. Stream fetching — yt-dlp

### 5.1 Pipeline

1. **Channel page URL** is derived from the stored `channelId` (`channelPageUrl`), then `/streams` is appended.
2. **Run yt-dlp** with `--flat-playlist --dump-json --playlist-end 20`, one process per channel, at most 20 entries. A failed run is retried once before the channel is reported as failed.
3. **Parse the JSONL output**: each line yields `{ id, title, live_status }`. Lines that fail to parse or lack an id/title are skipped.

### 5.2 Cover art

The thumbnail is derived from the video ID as `https://i.ytimg.com/vi/<videoId>/mqdefault.jpg`. That 320×180 image is 16:9, so it fills the grid tiles without black bars, and it needs no extra request because the URL is predictable.

### 5.3 State

| State       | Meaning                    | Indicator                 |
| ----------- | -------------------------- | ------------------------- |
| `Live`      | `live_status == "is_live"` | `Icon.Livestream`, "LIVE" |
| `Recording` | Everything else            | `Icon.Clock`, "RECORDING" |

`live_status` is reported by yt-dlp itself, so the answer is exact — no timestamp heuristic. Regular uploads do not appear at all because the `/streams` tab lists streams only.

### 5.4 Binary management (`lib/ytdlp.ts`)

- If `yt-dlp` is already on `PATH`, it is used as-is — no download.
- Otherwise the platform asset (`yt-dlp_macos` or `yt-dlp.exe`) is downloaded from the latest GitHub release into `<supportPath>/bin/`.
- The download is **verified against the release's `SHA2-256SUMS`** before being renamed into place and marked executable. A failed or mismatched download leaves nothing behind.
- A 60 s timeout guards both the download and the execution; failures surface as `network` errors.
- **Nothing is downloaded implicitly.** Stream fetching only resolves an existing binary and otherwise fails with a message pointing at the setup screen, so a 37 MB download never starts behind the user's back.

### 5.5 Setup screen (`components/ytdlp-install.tsx`)

When no binary is available the UI routes to a dedicated screen rather than downloading silently:

<<<<<<< HEAD

- The swap is **not** a parallel path: only one fetcher runs at a time.
- `lib/stream-source.ts` defines a single `fetchStreams(channel): Promise<Stream[]>` interface; `rss.ts` implements it now, a future `ytdlp.ts` would implement it later.
  \=======
- **Browse Streams** is the single entry point: when channels exist but the binary is missing, the command renders the setup screen itself instead of the grid, so no extra click is needed. Manage Channels deliberately stays focused on channel management.
- The screen explains what yt-dlp is, where it comes from (GitHub releases), that the `SHA2-256SUMS` checksum is verified, its size (~37 MB), that an existing system binary is used instead, and that it can be deleted any time.
- While downloading it reports progress in the detail text (`Downloading… 42% (15.4 MB of 36.0 MB)`), driven by the byte counter passed to `installYtDlp`.
- On success it toasts and calls `onInstalled`, which revalidates the caller — as the root view of Browse Streams it is replaced by the grid, as a pushed view it pops back.

> **Store caveat.** Downloading a binary at runtime may not satisfy Raycast Store review. For local use it is fine; a store build would have to require a user-installed yt-dlp.
>
> > > > > > > f35cf5f (fixup! Chore: Init commit)

---

## 6. Commands & UX

### 6.1 `index` — "Browse Streams" (`mode: view`)

A single screen, no channel-selection step:

- On open, load channels from local storage.
  - **Empty state** (no channels): a message offering to add one, with an **Add Channel** action that pushes the channel form.
  - Otherwise fetch streams for all channels in parallel and render one combined list. A channel that fails to load is reported in a toast; the rest of the list still renders.
  - If yt-dlp is not installed yet, the view shows a setup prompt instead of streams (§5.5) — fetching never triggers a download.
- The list is cached between runs with `useCachedPromise`: the last known streams appear immediately while a background refresh updates them, so the command never opens empty when it has data.
- Streams are ordered with `useFrecencySorting` keyed on the video ID, so streams the user opens often rise to the top. Unvisited streams keep the `Live`-before-`Recording` order that yt-dlp returns. Channels are not re-ordered by usage.
- Streams render in a `Grid` (3 columns, 16:9, `fit: fill`, `inset: zero`), so the cover art fills the whole cell — no padding, no letterboxing.
- Each `Grid.Item` shows:
  - Cover art as the item content.
  - Stream title.
  - Channel name (subtitle).
  - State icon with a `LIVE` / `RECORDING` tooltip — `Grid` items only accept an icon accessory, not a coloured tag.
- **Filters** — one `Grid.Dropdown` in `searchBarAccessory`, because the accessory holds a single element (opened with `⌘ P`):
  1. **All Streams** — every live stream and recording from every channel.
  2. **Channels** — one entry per channel, showing that channel's live streams and recordings together.
  3. **By State** — `Live` and `Recordings` across all channels; a state with no streams is not offered.
- The grouping follows the filter: with no channel selected the grid groups by channel; with a specific channel selected it groups by state, so the other dimension is always represented. Groups keep first-appearance order, preserving the frecency/live ordering.
- The built-in search bar filters by title; each item also carries its channel name and state as `keywords`.
- Empty states offer the way out: **Add Channel** and **Manage Channels** (which is where import lives), plus **Show All Streams** when only the filter is empty.
- Primary action **Start Stream** runs on Enter, with no confirmation. The window stays open so another stream can be started.
- The action shows one toast that turns from *Starting stream* into *Stream started* or *Could not start the stream*; the command also shows its progress bar while the request runs.
- Secondary actions: **Open in Browser** (`https://youtu.be/<id>`) and **Copy URL**, bound to `Keyboard.Shortcut.Common.Copy` — ⌘⇧C on macOS, Ctrl+Shift+C on Windows, which is why it does not clash with copying text from the search bar. Opening counts as a visit for frecency, so do starting a stream.

**Start Stream** flow:

1. Validate `videoId` against `^[A-Za-z0-9_-]{11}$`.
2. `GET {streamApiUrl}/api/stream?url=https://youtu.be/<id>` with `Authorization: Bearer <token>`, `redirect: "manual"`, and a 60 s `AbortSignal.timeout`. The `/api/stream` path is a constant in `api.ts`.
3. `302` → the toast becomes "Stream started" and the stream is recorded as visited. Any other status → the same toast becomes a failure carrying the status code; the token is redacted before it can reach the message.

### 6.2 Channel form — add and rename (`components/add-edit-channel-form.tsx`)

There is no standalone add command: adding happens from Manage Channels (and from the Browse Streams empty state). One component serves both modes, pushed onto the caller's navigation stack;
`AddEditChannelForm` distinguishes them by the presence of a `channel` prop.

**Add mode** has one input, and everything else appears once the channel is found:

1. **Channel** (required) — a channel name to search, or any channel URL form (`@handle`, `/channel/UC…`, `/user/…`, `/streams`), or a bare `UC…` ID. A `Form.Separator` closes the input block.
2. **Title** — hidden until the lookup succeeds, then shown pre-filled from YouTube and editable so the row can be labelled differently. It is **required** whenever it is shown: submit is refused while it is empty.
3. **Description** — appears with the Title as a read-only text block: the channel's About text, pulled from `ytInitialData` (`metadata.channelMetadataRenderer.description`), falling back to the truncated `og:description` meta tag. Shown in add mode only, where it helps disambiguate a search result.

- The search is **debounced**: once typing stops for 0.8 s the reference is resolved, so no blur or explicit button is needed. Changing the text invalidates the result and re-triggers the lookup; the last fetched title stays on screen until the new one arrives. A successful lookup fills the title and clears its validation error.
- Lookups are non-blocking: `Form.isLoading` only shows a loading bar (Raycast does not disable the inputs), so the user keeps typing while the request runs.
- On submit the resolver runs again only if the text changed since the last successful lookup, then the entry is stored with the (possibly edited) title plus the fetched `channelId`, `thumbnail` and `description`.
- Because a name search can pick the wrong channel, the Channel field's `info` tells the user to enter the full channel URL if the result is not what they expected.
- A bare name is resolved through YouTube search (Channels filter). That page intermittently omits channel entries, so the resolver retries a few times before failing, and the error always suggests pasting the URL instead.
- Links that are not channel URLs (a video, the YouTube home page) are rejected up front rather than being searched for.
- Channel ID and URL are not surfaced in the form: they are not meaningful to the user. Forms cannot render images, so the avatar appears as the submit action's icon and in the channel list (see §6.3).

**Rename mode** shows only the Title field (pre-filled), with the avatar on the submit action. The description is not repeated there.

### 6.3 `manage-channels` — "Manage Channels" (`mode: view`)

- Lists saved channels with avatar and title, plus a search bar. The canonical URL is not shown; it stays behind the Open in Browser action.
- **Edit** pushes the form in rename mode: the **title is editable**, while the channel ID and avatar cannot be changed (they come from YouTube).
- **Add Channel** pushes the form in add mode, where the input is a URL, `@handle` or name that gets resolved.
- **Remove** asks for confirmation, deletes, and refreshes the list.
- The list revalidates when a pushed form is popped, so changes show immediately.

### 6.4 Import & export (actions on Manage Channels)

Both live inside the Manage Channels command rather than as separate commands:

- **Export Channels** (an action, no view): writes `<supportPath>/exports/channels-<YYYY-MM-DD>.json`, pretty-printed with a trailing newline so it diffs well, toasts `Exported N channels` with the path, and reveals the file with `showInFinder`. An empty list produces "Nothing to export" instead of a file.
- **Import Channels** (pushes a form): a single `Form.FilePicker` limited to `.json`. The file is parsed and merged, then the toast reports "Imported N, skipped M duplicates" and the form pops back to the list, which revalidates.

Import rules:

- Accepts a bare array of records or a `{ "channels": [...] }` wrapper.
- Every record is validated with the same guard the store uses. If any record is invalid the import is **atomic**: nothing is written and the error names the offending entry.
- Merges into the existing list and de-duplicates by `channelId`. Existing channels are never modified or overwritten.
- Malformed JSON raises a `UserError`; the stored list is left untouched.
- The export contains channel names, IDs and avatars only — never the API token.

---

## 7. Module layout

```
src/
  index.tsx              # Browse Streams command (single screen, still the WI-1 placeholder)
  manage-channels.tsx    # Manage Channels command (list, add, rename, remove)
  components/
    add-edit-channel-form.tsx  # shared add/rename form, pushed from other views
    import-channels-form.tsx   # file picker + merge, pushed from Manage Channels
    ytdlp-install.tsx    # yt-dlp setup screen with download progress
  lib/
    types.ts             # Channel, Stream, StreamState
    channels.ts          # LocalStorage-backed channel store with shape validation
    channel-io.ts        # serialize, parse, merge and write channel exports
    channel-resolver.ts  # URL, @handle or name → canonical Channel details
    ytdlp.ts             # yt-dlp bootstrap, install progress, fetchStreams()
    stream-source.ts     # fetchStreams() interface (RSS now, yt-dlp later)
    api.ts               # startStream(videoId, serviceConfig)
    text.ts              # XML/HTML entity decoding shared by scraper and feed parser
    errors.ts            # user-facing error mapping
```

Modules marked _planned_ do not exist yet; everything else is implemented.

---

## 8. Data flow

```
Channel form (add) ──resolve──▶ LocalStorage ◀──merge── Import Channels (JSON file)
                                    │
Browse Streams ──reads──────────────┤
                                    └──reads──▶ Export Channels (JSON file)
        │
        ▼
  load channels ──▶ for each: fetchStreams() (yt-dlp)
                            │
                            ▼
              Stream[] (videoId, title, channel, thumbnail, state)
                            │
                            ▼
          [Single list] ──filter by channel/state──▶ [List.Item]
                            │
                         Enter
                            ▼
                       startStream()
                            │
                            ▼
            GET {streamApiUrl}/api/stream?url=…  (Bearer token)
                            │
               302 → success | else → error toast
```

---

## 9. Error handling

| Condition                                  | Behaviour                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| Missing/invalid preferences (URL or token) | Failure toast + action to open preferences.                                     |
| No channels added                          | Empty state with "Add Channel" action.                                          |
| Channel ID resolution fails                | Error toast for that channel; other channels still load.                        |
| yt-dlp fails for a channel                 | Error toast naming the channel; the rest still render.                          |
| Stream list empty                          | Empty state "No streams found".                                                 |
| Invalid video ID                           | Error toast before any network call.                                            |
| API timeout (> 60 s)                       | Error toast "Request timed out".                                                |
| API non-302                                | Error toast with HTTP status code; never include the token.                     |
| Import file or JSON is malformed           | `UserError` naming the problem; nothing is written.                             |
| Import contains an invalid record          | Whole import rejected (atomic); the offending entry named.                      |
| Import has only duplicates                 | Toast "Imported 0, skipped M duplicates".                                       |
| Export with an empty list                  | Toast "Nothing to export".                                                      |
| Export file write fails                    | Error toast; the file is the only export path, so nothing else to fall back on. |

---

## 10. Security

- Token lives in the Raycast `password` preference (macOS Keychain), never on disk in plaintext in the extension's own files.
- Token is sent only in the `Authorization` header of the `fetch` call. It is never placed in process arguments, and never interpolated into logs, toasts, or error strings.
- No external secret manager is required.

---

## 11. Key decisions & trade-offs

| Decision        | Choice                                    | Rationale / trade-off                                                                                                                                                                                       |
| --------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channel storage | `LocalStorage` (JSON array)               | Native Raycast storage, no runtime dependency, simplest code, empty on first run. Trade-off: whole-list read-modify-write, no constraints or schema migrations.                                             |
| UX              | Single combined stream list               | Raycast UI removes the need for a channel-selection step; filters cover navigation.                                                                                                                         |
| Stream source   | yt-dlp (auto-downloaded)                  | The only source that reports an exact `live_status`. Trade-off: a runtime binary download, which the Store may reject.                                                                                      |
| State model     | `StreamState` enum (`Live` / `Recording`) | Two states are enough for the product; `live_status` makes `Live` exact and `/streams` excludes ordinary uploads, so `Recording` means a finished stream.                                                   |
| Token storage   | Raycast `password` preference             | Native, secure, no external CLI dependency.                                                                                                                                                                 |
| Import/export   | File-based JSON, merge by ID              | Symmetric round-trip and a usable backup; imports are atomic and never overwrite existing channels. Trade-off: no clipboard path, no "replace all" mode, no conflict resolution beyond skipping duplicates. |
| HTTP semantics  | `fetch` with `redirect: "manual"`         | Required to observe the service's 302 contract (`fetch` follows redirects by default).                                                                                                                      |
| UX on Enter     | Direct start + secondary actions          | Direct start with no confirmation; open/copy are additive.                                                                                                                                                  |

---

## 12. Open questions for implementation

1. **Storage growth.** `LocalStorage` holds the channel list as one JSON value. If streams or play history are ever persisted, revisit storage capacity and access patterns.
2. **Store strategy.** `LocalStorage` is store-friendly, but the runtime yt-dlp download may not be. A store build would need either a user-installed yt-dlp or a different source (§5.4).
3. **Import conflict policy.** Current design merges and skips duplicates. Confirm that a "replace all" option is not needed, and whether importing should refresh `thumbnail` for channels that already exist.
4. **Avatar preview.** Forms cannot render images, so the fetched avatar only appears in the channel list. Confirm that is enough, or whether add should end with a preview step.
