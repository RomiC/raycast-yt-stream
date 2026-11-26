import { Action, ActionPanel, Alert, Icon, List, Toast, confirmAlert, showToast, useNavigation } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { AddEditChannelForm } from "./components/add-edit-channel-form";
import { channelPageUrl } from "./lib/channel-resolver";
import { deleteChannel, listChannels } from "./lib/channels";
import { toUserMessage } from "./lib/errors";
import type { Channel } from "./lib/types";

export default function ManageChannels() {
  const { push } = useNavigation();
  const { data: channels, isLoading, error, revalidate } = usePromise(listChannels);

  const openForm = (channel?: Channel) => push(<AddEditChannelForm channel={channel} />, revalidate);

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
        description="Add your first channel to start streaming."
        actions={
          <ActionPanel>
            <Action title="Add Channel" icon={Icon.Plus} onAction={() => openForm()} />
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
