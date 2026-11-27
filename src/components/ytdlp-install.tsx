import { Action, ActionPanel, Detail, Icon, Toast, showToast, useNavigation } from "@raycast/api";
import { useState } from "react";
import { toUserMessage } from "../lib/errors";
import { installYtDlp, type DownloadProgress } from "../lib/ytdlp";

const INFO = `# yt-dlp is required

The extension asks **yt-dlp** which streams on your channels are live. YouTube's public feeds do not expose that, so without it every stream looks the same.

- Downloaded from the official [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases) on GitHub
- Verified against the release \`SHA2-256SUMS\` before it is used
- Stored in this extension's support folder, about 37 MB — delete it any time
- If you already have \`yt-dlp\` on your \`PATH\`, it is used instead and nothing is downloaded
`;

function progressMarkdown(progress: DownloadProgress | undefined): string {
  if (!progress) {
    return `${INFO}\nPress **Download yt-dlp** to start.`;
  }

  const received = `${(progress.received / 1024 / 1024).toFixed(1)} MB`;
  const percentage = progress.total > 0 ? Math.floor((progress.received / progress.total) * 100) : undefined;
  const amount =
    percentage === undefined
      ? received
      : `${percentage}% (${received} of ${(progress.total / 1024 / 1024).toFixed(1)} MB)`;

  return `${INFO}\n---\n\n**Downloading… ${amount}**`;
}

/** Setup screen for the yt-dlp binary: explains the download and reports its progress. */
export function YtDlpInstall({ onInstalled }: { onInstalled?: () => void }) {
  const { pop } = useNavigation();
  const [progress, setProgress] = useState<DownloadProgress>();
  const [isLoading, setIsLoading] = useState(false);

  async function install() {
    setIsLoading(true);
    setProgress({ received: 0, total: 0 });
    try {
      await installYtDlp(setProgress);
      await showToast({ style: Toast.Style.Success, title: "yt-dlp installed" });
      onInstalled?.();
      pop();
    } catch (failure) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not install yt-dlp",
        message: toUserMessage(failure),
      });
    } finally {
      setIsLoading(false);
      setProgress(undefined);
    }
  }

  return (
    <Detail
      isLoading={isLoading}
      navigationTitle="yt-dlp Setup"
      markdown={progressMarkdown(progress)}
      actions={
        <ActionPanel>
          <Action title="Download Now" icon={Icon.Download} onAction={install} />
        </ActionPanel>
      }
    />
  );
}
