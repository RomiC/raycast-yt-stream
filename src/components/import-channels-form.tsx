import { Action, ActionPanel, Form, Toast, showToast, useNavigation } from "@raycast/api";
import { FormValidation, useForm } from "@raycast/utils";
import { readFile } from "node:fs/promises";
import { parseChannels } from "../lib/channel-io";
import { importChannels } from "../lib/channels";
import { toUserMessage } from "../lib/errors";

/** Pushed from Manage Channels; reports the merged result back to the caller. */
export function ImportChannelsForm({ onImported }: { onImported?: () => void }) {
  const { pop } = useNavigation();

  const { handleSubmit, itemProps } = useForm<{ files: string[] }>({
    async onSubmit(values) {
      const [file] = values.files;
      try {
        const records = parseChannels(await readFile(file, "utf8"));
        const { imported, skipped } = await importChannels(records);
        await showToast({
          style: Toast.Style.Success,
          title: `Imported ${imported}, skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}`,
        });
        onImported?.();
        pop();
      } catch (failure) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Could not import channels",
          message: toUserMessage(failure),
        });
      }
    },
    validation: {
      files: FormValidation.Required,
    },
  });

  return (
    <Form
      navigationTitle="Import Channels"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Import Channels" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.FilePicker
        title="Channels File"
        info="A JSON file produced by Export Channels. Existing channels are kept and duplicates skipped."
        allowMultipleSelection={false}
        canChooseDirectories={false}
        canChooseFiles={true}
        {...itemProps.files}
      />
    </Form>
  );
}
