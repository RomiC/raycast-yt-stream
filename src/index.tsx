import { List, Icon } from "@raycast/api";

export default function BrowseStreams() {
  return (
    <List isLoading={false} searchBarPlaceholder="Search streams">
      <List.EmptyView
        icon={Icon.Video}
        title="No channels yet"
        description="Add a YouTube channel to see its streams here."
      />
    </List>
  );
}
