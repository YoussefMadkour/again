import "server-only";
import { getConfig } from "@/lib/config";
import { MockWorldProvider } from "./providers/mock/world";
import { WorldLabsProvider } from "./providers/real/worldlabs";
import type { WorldProvider } from "./types";

let owner: WorldProvider | null | undefined;

/**
 * `visitorKey` is a visitor's own World Labs key: used for their request only, never stored.
 * Without one, the owner's key. Null when real mode has no owner key configured.
 */
export function getWorldProvider(visitorKey?: string | null): WorldProvider | null {
  const config = getConfig();
  if (config.AI_MODE === "mock") {
    owner ??= new MockWorldProvider();
    return owner;
  }
  if (visitorKey) return new WorldLabsProvider(visitorKey, config.WORLDLABS_MODEL);
  if (owner !== undefined) return owner;
  owner = config.WORLDLABS_API_KEY
    ? new WorldLabsProvider(config.WORLDLABS_API_KEY, config.WORLDLABS_MODEL)
    : null;
  return owner;
}
