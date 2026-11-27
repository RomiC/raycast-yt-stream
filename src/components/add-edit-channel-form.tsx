import { Action, ActionPanel, Form, Icon, Toast, showToast, useNavigation } from "@raycast/api";
import { FormValidation, useForm } from "@raycast/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { resolveChannel, type ResolvedChannel } from "../lib/channel-resolver";
import { insertChannel, renameChannel } from "../lib/channels";
import { toUserMessage } from "../lib/errors";
import type { Channel } from "../lib/types";

const SEARCH_DEBOUNCE_MS = 800;

interface ChannelFormValues {
  channel: string;
  name: string;
}

/** A cancelled lookup is expected while typing, so it must not surface as an error. */
function isCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** Add mode without a channel, rename mode with one. */
export function AddEditChannelForm({ channel }: { channel?: Channel }) {
  const { pop } = useNavigation();
  const [resolved, setResolved] = useState<ResolvedChannel>();
  const [resolvedInput, setResolvedInput] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);

  const details = resolved ?? channel;
  // The title is only meaningful once a channel is known: rename mode, or a successful add lookup.
  const showTitle = Boolean(channel || resolved);

  const { handleSubmit, itemProps, setValue, setValidationError, values } = useForm<ChannelFormValues>({
    initialValues: { channel: "", name: channel?.name ?? "" },
    async onSubmit(values) {
      setIsLoading(true);
      try {
        if (channel) {
          const renamed = await renameChannel(channel.id, values.name);
          await showToast({ style: Toast.Style.Success, title: `Renamed to ${renamed.name}` });
        } else {
          const input = values.channel.trim();
          const isCurrent = Boolean(resolved) && resolvedInput === input;
          const fetched = isCurrent && resolved ? resolved : await lookup(input);
          const added = await insertChannel({
            // An edited title only applies to the channel it was typed for; otherwise the fresh one wins.
            name: isCurrent ? values.name.trim() || fetched.name : fetched.name,
            channelId: fetched.channelId,
            thumbnail: fetched.thumbnail,
            description: fetched.description,
          });
          await showToast({ style: Toast.Style.Success, title: `Added ${added.name}` });
        }
        pop();
      } catch (failure) {
        const message = toUserMessage(failure);
        setValidationError(channel ? "name" : "channel", message);
        await showToast({ style: Toast.Style.Failure, title: "Could not save the channel", message });
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    validation: {
      channel: channel ? undefined : FormValidation.Required,
      name: showTitle ? FormValidation.Required : undefined,
    },
  });

  const latestInput = useRef<string | undefined>(undefined);

  const lookup = useCallback(
    async (input: string, signal?: AbortSignal) => {
      latestInput.current = input;
      const fetched = await resolveChannel(input, { signal });
      if (latestInput.current !== input) {
        return fetched;
      }

      setResolved(fetched);
      setResolvedInput(input);
      setValue("name", fetched.name);
      setValidationError("channel", undefined);
      setValidationError("name", undefined);
      return fetched;
    },
    [setValue, setValidationError],
  );

  const query = values.channel.trim();

  // Debounced lookup: the single field doubles as name entry and search trigger.
  useEffect(() => {
    if (channel || !query || query === resolvedInput) {
      return;
    }

    // The controller cancels the request itself, so typing on does not leave work running.
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setIsLoading(true);
      lookup(query, controller.signal)
        .catch((failure) => {
          if (latestInput.current === query && !isCancellation(failure)) {
            setValidationError("channel", toUserMessage(failure));
          }
        })
        .finally(() => setIsLoading(false));
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [channel, query, resolvedInput, lookup, setValidationError]);

  return (
    <Form
      isLoading={isLoading}
      navigationTitle={channel ? "Edit Channel" : "Add Channel"}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={channel ? "Save Name" : "Add Channel"}
            icon={details?.thumbnail ? { source: details.thumbnail } : Icon.Plus}
            onSubmit={handleSubmit}
          />
        </ActionPanel>
      }
    >
      {channel ? null : (
        <>
          <Form.TextField
            title="Channel"
            placeholder="Channel name or URL"
            info="Enter a name to search, or the full channel URL if the result is not the channel you expected."
            {...itemProps.channel}
          />
          <Form.Separator />
        </>
      )}
      {showTitle ? (
        <Form.TextField
          title="Title"
          placeholder="Channel title"
          info="Fetched from YouTube. Change it if you want a different label in your list."
          {...itemProps.name}
        />
      ) : null}
      {!channel && details?.description ? <Form.Description title="Description" text={details.description} /> : null}
    </Form>
  );
}
