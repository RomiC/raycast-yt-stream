import { Action, ActionPanel, Grid, Icon, Keyboard, Toast, open, showToast, useNavigation } from "@raycast/api";
import { useCachedPromise, useFrecencySorting } from "@raycast/utils";
import { AddEditChannelForm } from "./components/add-edit-channel-form";
import { YtDlpInstall } from "./components/ytdlp-install";
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

  const addChannel = () => push(<AddEditChannelForm />, revalidate);

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

  return (
    <Grid
      isLoading={isLoading}
      columns={3}
      aspectRatio="16/9"
      fit={Grid.Fit.Fill}
      inset={Grid.Inset.Zero}
      searchBarPlaceholder="Search streams"
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
      {streams.map((stream) => (
        <Grid.Item
          key={stream.videoId}
          content={{ source: stream.thumbnail }}
          title={stream.title}
          subtitle={stream.channelName}
          accessory={STATE_BADGE[stream.state]}
          actions={
            <ActionPanel>
              <Action
                title="Open in Browser"
                icon={Icon.Globe}
                onAction={() => {
                  visitItem(stream);
                  void open(`https://youtu.be/${stream.videoId}`);
                }}
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
    </Grid>
  );
}
