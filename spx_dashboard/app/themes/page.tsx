import { TwitterMonitor } from "@/components/TwitterMonitor";
import { getFollowedHandles, getTwitterData } from "@/lib/tweets";

export default function ThemesPage() {
  return (
    <TwitterMonitor
      data={getTwitterData()}
      canonicalFollowed={getFollowedHandles()}
    />
  );
}
