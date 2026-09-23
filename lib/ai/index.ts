import "server-only";
import { getConfig } from "@/lib/config";
import { MockWorldProvider } from "./providers/mock/world";
import { WorldLabsProvider } from "./providers/real/worldlabs";
import type { WorldProvider } from "./types";

let world: WorldProvider | undefined;

export function getWorldProvider(): WorldProvider {
  if (world) return world;
  const config = getConfig();
  world =
    config.AI_MODE === "real"
      ? new WorldLabsProvider(config.WORLDLABS_API_KEY, config.WORLDLABS_MODEL)
      : new MockWorldProvider();
  return world;
}
