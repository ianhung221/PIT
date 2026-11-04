import { HomeClient } from "./HomeClient";
import { LocalNetworkPreview } from '@/components/game/LocalNetworkPreview';

export const dynamic = "force-static";

export default function Home() {
  return <LocalNetworkPreview><HomeClient networkEnabled /></LocalNetworkPreview>;
}
