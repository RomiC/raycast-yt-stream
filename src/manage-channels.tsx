import {
  Action,
  ActionPanel,
  Alert,
  Icon,
  List,
  Toast,
  confirmAlert,
  showInFinder,
  showToast,
  useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { AddEditChannelForm } from "./components/add-edit-channel-form";
import { ImportChannelsForm } from "./components/import-channels-form";
import { channelPageUrl } from "./lib/channel-resolver";
import { exportChannelsToFile } from "./lib/channel-io";
import { deleteChannel, listChannels } from "./lib/channels";
import { toUserMessage } from "./lib/errors";
import type { Channel } from "./lib/types";

export default function ManageChannels() {
  const { push } = useNavigation();
  const { data: channels, isLoading, error, revalidate } = usePromise(listChannels);

  const openForm = (channel?: Channel) => push(<AddEditChannelForm channel={channel} />, revalidate);

  async function exportChannels() {
    try {
      const channels = await listChannels();
      if (channels.length === 0) {
        await showToast({ style: Toast.Style.Failure, title: "Nothing to export", message: "Add a channel first." });
        return;
      }

      const file = await exportChannelsToFile(channels);
      await showToast({
        style: Toast.Style.Success,
        title: `Exported ${channels.length} channel${channels.length === 1 ? "" : "s"}`,
        message: file,
      });
      await showInFinder(file);
    } catch (failure) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not export channels",
        message: toUserMessage(failure),
      });
    }
  }

  if (error) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Warning}
          title="Could not load your channels"
          description={toUserMessage(error)}
          actions={
            <ActionPanel>
              <Action title="Try Again" icon={Icon.ArrowClockwise} onAction={revalidate} />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search channels">
      <List.EmptyView
        icon={Icon.Person}
        title="No channels yet"
        description="Add your first channel, or import an existing list."
        actions={
          <ActionPanel>
            <Action title="Add Channel" icon={Icon.Plus} onAction={() => openForm()} />
            <Action
              title="Import Channels"
              icon={Icon.Download}
              onAction={() => push(<ImportChannelsForm onImported={revalidate} />)}
            />
          </ActionPanel>
        }
      />
      {channels?.map((channel) => (
        <List.Item
          key={channel.id}
          icon={channel.thumbnail ? { source: channel.thumbnail } : Icon.Person}
          title={channel.name}
          actions={
            <ActionPanel>
              <Action title="Edit Channel" icon={Icon.Pencil} onAction={() => openForm(channel)} />
              <Action title="Add Channel" icon={Icon.Plus} onAction={() => openForm()} />
              <Action
                title="Import Channels"
                icon={Icon.Download}
                onAction={() => push(<ImportChannelsForm onImported={revalidate} />)}
              />
              <Action title="Export Channels" icon={Icon.Upload} onAction={exportChannels} />
              <Action.OpenInBrowser title="Open Channel in Browser" url={channelPageUrl(channel.channelId)} />
              <Action
                title="Remove Channel"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                shortcut={{
                  macOS: { modifiers: ["cmd", "shift"], key: "backspace" },
                  Windows: { modifiers: ["ctrl", "shift"], key: "backspace" },
                }}
                onAction={() => removeChannel(channel, revalidate)}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

async function removeChannel(channel: Channel, revalidate: () => void) {
  const confirmed = await confirmAlert({
    title: `Remove ${channel.name}?`,
    message: "This only removes the channel from your list.",
    primaryAction: { title: "Remove", style: Alert.ActionStyle.Destructive },
  });
  if (!confirmed) {
    return;
  }

  try {
    await deleteChannel(channel.id);
    await showToast({ style: Toast.Style.Success, title: `Removed ${channel.name}` });
    revalidate();
  } catch (failure) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Could not remove the channel",
      message: toUserMessage(failure),
    });
  }
}
