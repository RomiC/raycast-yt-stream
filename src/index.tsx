import { Action, ActionPanel, Grid, Icon, Keyboard, Toast, open, showToast, useNavigation } from "@raycast/api";
import { useCachedPromise, useFrecencySorting } from "@raycast/utils";
import { useState } from "react";
import { AddEditChannelForm } from "./components/add-edit-channel-form";
import { YtDlpInstall } from "./components/ytdlp-install";
import { getServiceConfig, startStream } from "./lib/api";
import { listChannels } from "./lib/channels";
import { toUserMessage } from "./lib/errors";
import { fetchStreams, isYtDlpReady } from "./lib/ytdlp";
import { StreamState, type Stream } from "./lib/types";

const STATE_ORDER: Record<StreamState, number> = { [StreamState.Live]: 0, [StreamState.Recording]: 1 };

// Grid items only accept an icon accessory, so the state is carried by the icon plus its tooltip.
const STATE_BADGE: Record<StreamState, { icon: Icon; tooltip: string }> = {
  [StreamState.Live]: { icon: Icon.Livestream, tooltip: "LIVE" },
  [StreamState.Recording]: { icon: Icon.Clock, tooltip: "RECORDING" },
};

const STATE_TITLE: Record<StreamState, string> = {
  [StreamState.Live]: "Live",
  [StreamState.Recording]: "Recordings",
};

/** One control carries both dimensions: the state, optionally narrowed to a single channel. */
type Filter = { state: StreamState | "all"; channelId: string | null };

const ANY_FILTER: Filter = { state: "all", channelId: null };

function serializeFilter(filter: Filter): string {
  return `${filter.state}|${filter.channelId ?? "all"}`;
}

function parseFilter(value: string): Filter {
  const [state, channelId] = value.split("|");
  return { state: state as Filter["state"], channelId: channelId === "all" ? null : channelId };
}

function channelOptions(streams: Stream[]): { channelId: string; channelName: string }[] {
  const seen = new Map<string, string>();
  for (const stream of streams) {
    seen.set(stream.channelId, stream.channelName);
  }
  return [...seen].map(([channelId, channelName]) => ({ channelId, channelName }));
}

type GroupDimension = "channel" | "state";
type Group = { key: string; title: string; streams: Stream[] };

/** Whichever dimension is not filtered becomes the grouping, so both are always represented. */
function groupStreams(streams: Stream[], dimension: GroupDimension): Group[] {
  const groups = new Map<string, Group>();
  for (const stream of streams) {
    const [key, title] =
      dimension === "channel" ? [stream.channelId, stream.channelName] : [stream.state, STATE_TITLE[stream.state]];

    const group = groups.get(key) ?? { key, title, streams: [] };
    group.streams.push(stream);
    groups.set(key, group);
  }
  return [...groups.values()];
}

type BrowseData = { channelCount: number; streams: Stream[]; failedChannels: number; ytDlpReady: boolean };

async function loadStreams(): Promise<BrowseData> {
  const channels = await listChannels();
  if (channels.length > 0 && !(await isYtDlpReady())) {
    return { channelCount: channels.length, streams: [], failedChannels: 0, ytDlpReady: false };
  }

  const results = await Promise.allSettled(channels.map((channel) => fetchStreams(channel)));

  const streams = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  streams.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]);

  const failedChannels = results.filter((result) => result.status === "rejected").length;
  return { channelCount: channels.length, streams, failedChannels, ytDlpReady: true };
}

export default function BrowseStreams() {
  const { push } = useNavigation();
  const { data, isLoading, error, revalidate } = useCachedPromise(loadStreams, [], {
    onData: (result) => {
      if (result.failedChannels > 0) {
        showToast({
          style: Toast.Style.Failure,
          title: `${result.failedChannels} channel(s) could not be loaded`,
          message: "The other channels are still shown.",
        });
      }
    },
  });

  // Streams the user opens often float to the top; the rest keep the live-first order.
  const { data: streams, visitItem } = useFrecencySorting(data?.streams, {
    namespace: "streams",
    key: (stream) => stream.videoId,
    sortUnvisited: (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state],
  });

  const [filter, setFilter] = useState<Filter>(ANY_FILTER);
  const [isStarting, setIsStarting] = useState(false);

  const addChannel = () => push(<AddEditChannelForm />, revalidate);

  async function start(stream: Stream) {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Starting stream", message: stream.title });
    let token: string | undefined;

    setIsStarting(true);
    try {
      const config = getServiceConfig();
      token = config.token;
      await startStream(stream.videoId, config);
      await visitItem(stream);
      toast.style = Toast.Style.Success;
      toast.title = "Stream started";
    } catch (failure) {
      toast.style = Toast.Style.Failure;
      toast.title = "Could not start the stream";
      toast.message = toUserMessage(failure, token ? [token] : []);
    } finally {
      setIsStarting(false);
    }
  }

  if (error) {
    return (
      <Grid>
        <Grid.EmptyView
          icon={Icon.Warning}
          title="Could not load your streams"
          description={toUserMessage(error)}
          actions={
            <ActionPanel>
              <Action title="Try Again" icon={Icon.ArrowClockwise} onAction={revalidate} />
            </ActionPanel>
          }
        />
      </Grid>
    );
  }

  if (!isLoading && data?.ytDlpReady === false) {
    return <YtDlpInstall onInstalled={revalidate} />;
  }

  if (!isLoading && data?.channelCount === 0) {
    return (
      <Grid>
        <Grid.EmptyView
          icon={Icon.Video}
          title="No channels yet"
          description="Add a channel to see its streams here."
          actions={
            <ActionPanel>
              <Action title="Add Channel" icon={Icon.Plus} onAction={addChannel} />
            </ActionPanel>
          }
        />
      </Grid>
    );
  }

  const visible = streams.filter(
    (stream) =>
      (filter.state === "all" || stream.state === filter.state) &&
      (filter.channelId === null || stream.channelId === filter.channelId),
  );
  const groups = groupStreams(visible, filter.channelId ? "state" : "channel");
  const channels = channelOptions(streams);
  const states = [StreamState.Live, StreamState.Recording].filter((state) =>
    streams.some((stream) => stream.state === state),
  );

  return (
    <Grid
      isLoading={isLoading || isStarting}
      columns={3}
      aspectRatio="16/9"
      fit={Grid.Fit.Fill}
      inset={Grid.Inset.Zero}
      searchBarPlaceholder="Search streams"
      searchBarAccessory={
        <Grid.Dropdown
          tooltip="Filter Streams"
          value={serializeFilter(filter)}
          onChange={(value) => setFilter(parseFilter(value))}
        >
          <Grid.Dropdown.Item value={serializeFilter(ANY_FILTER)} title="All Streams" icon={Icon.Video} />
          {channels.length > 0 ? (
            <Grid.Dropdown.Section title="Channels">
              {channels.map((channel) => (
                <Grid.Dropdown.Item
                  key={channel.channelId}
                  value={serializeFilter({ state: "all", channelId: channel.channelId })}
                  title={channel.channelName}
                  icon={Icon.Person}
                />
              ))}
            </Grid.Dropdown.Section>
          ) : null}
          {states.length > 0 ? (
            <Grid.Dropdown.Section title="By State">
              {states.map((state) => (
                <Grid.Dropdown.Item
                  key={state}
                  value={serializeFilter({ state, channelId: null })}
                  title={STATE_TITLE[state]}
                  icon={STATE_BADGE[state].icon}
                />
              ))}
            </Grid.Dropdown.Section>
          ) : null}
        </Grid.Dropdown>
      }
    >
      {!isLoading && streams.length === 0 ? (
        <Grid.EmptyView
          icon={Icon.Video}
          title="No streams found"
          description="Your channels have no recent streams."
          actions={
            <ActionPanel>
              <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={revalidate} />
              <Action title="Add Channel" icon={Icon.Plus} onAction={addChannel} />
            </ActionPanel>
          }
        />
      ) : null}
      {!isLoading && streams.length > 0 && visible.length === 0 ? (
        <Grid.EmptyView
          icon={Icon.Filter}
          title="No streams for this filter"
          description="Nothing matches the selected state."
          actions={
            <ActionPanel>
              <Action title="Show All Streams" icon={Icon.XMarkCircle} onAction={() => setFilter(ANY_FILTER)} />
            </ActionPanel>
          }
        />
      ) : null}
      {groups.map((group) => (
        <Grid.Section key={group.key} title={group.title} subtitle={`${group.streams.length}`}>
          {group.streams.map((stream) => (
            <Grid.Item
              key={stream.videoId}
              content={{ source: stream.thumbnail }}
              title={stream.title}
              subtitle={stream.channelName}
              keywords={[stream.channelName, STATE_BADGE[stream.state].tooltip]}
              accessory={STATE_BADGE[stream.state]}
              actions={
                <ActionPanel>
                  <Action title="Start Stream" icon={Icon.PlayFilled} onAction={() => start(stream)} />
                  <Action
                    title="Open in Browser"
                    icon={Icon.Globe}
                    onAction={() => {
                      visitItem(stream);
                      void open(`https://youtu.be/${stream.videoId}`);
                    }}
                  />
                  <Action.CopyToClipboard
                    title="Copy URL"
                    content={`https://youtu.be/${stream.videoId}`}
                    shortcut={Keyboard.Shortcut.Common.Copy}
                  />
                  <Action
                    title="Refresh"
                    icon={Icon.ArrowClockwise}
                    onAction={revalidate}
                    shortcut={Keyboard.Shortcut.Common.Refresh}
                  />
                  <Action title="Add Channel" icon={Icon.Plus} onAction={addChannel} />
                </ActionPanel>
              }
            />
          ))}
        </Grid.Section>
      ))}
    </Grid>
  );
}
