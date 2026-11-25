import { List, Icon } from "@raycast/api";

export default function ManageChannels() {
  return (
    <List isLoading={false} searchBarPlaceholder="Search channels">
      <List.EmptyView icon={Icon.Person} title="No channels yet" description="Add your first channel." />
    </List>
  );
}
