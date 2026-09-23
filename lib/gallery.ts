/**
 * Public gallery of memories whose makers opted in. Entries are snapshots of the world's
 * public CDN assets, so opening one needs no API key and costs nothing.
 */
import type { WorldResult } from "./ai/types";
import { randomId } from "./id";
import type { Store } from "./store";

export interface GalleryEntry {
  id: string;
  createdAt: string;
  /** The original photograph. */
  photoUrl: string;
  /** A render of the generated world, shown on hover. */
  thumbnailUrl?: string;
  world: WorldResult;
}

/** What the homepage needs; the world assets are fetched only when an entry is opened. */
export type GalleryCard = Pick<GalleryEntry, "id" | "photoUrl" | "thumbnailUrl">;

const KEY = "gallery";
const MAX_ENTRIES = 60;

export async function listGallery(store: Store): Promise<GalleryEntry[]> {
  return (await store.get<GalleryEntry[]>(KEY)) ?? [];
}

export async function galleryCards(store: Store): Promise<GalleryCard[]> {
  return (await listGallery(store)).map(({ id, photoUrl, thumbnailUrl }) => ({
    id,
    photoUrl,
    thumbnailUrl,
  }));
}

export async function getGalleryEntry(store: Store, id: string) {
  return (await listGallery(store)).find((e) => e.id === id) ?? null;
}

export async function addToGallery(store: Store, world: WorldResult): Promise<GalleryEntry | null> {
  if (!world.sourcePhotoUrl) return null;
  const entries = await listGallery(store);
  const existing = entries.find(
    (e) => e.world.metadata.worldId && e.world.metadata.worldId === world.metadata.worldId,
  );
  if (existing) return existing;
  const entry: GalleryEntry = {
    id: randomId(8),
    createdAt: new Date().toISOString(),
    photoUrl: world.sourcePhotoUrl,
    thumbnailUrl: world.thumbnailUrl,
    world,
  };
  await store.set(KEY, [entry, ...entries].slice(0, MAX_ENTRIES));
  return entry;
}

export async function removeFromGallery(store: Store, id: string): Promise<boolean> {
  const entries = await listGallery(store);
  const next = entries.filter((e) => e.id !== id);
  if (next.length === entries.length) return false;
  await store.set(KEY, next);
  return true;
}

/** Server-side record of a generation in flight: whether its maker asked to share it. */
export interface JobRecord {
  share: boolean;
  published?: boolean;
}

export const jobKey = (jobId: string) => `job:${jobId}`;
