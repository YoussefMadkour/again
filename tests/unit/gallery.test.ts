import { describe, expect, it } from "vitest";
import type { WorldResult } from "@/lib/ai/types";
import { addToGallery, galleryCards, getGalleryEntry, removeFromGallery } from "@/lib/gallery";
import { MemoryStore } from "@/lib/store";

const world = (id: string, photo = `https://cdn/${id}.jpg`): WorldResult => ({
  splatUrl: `https://cdn/${id}.spz`,
  format: "spz",
  metricScale: 1,
  sourcePhotoUrl: photo,
  thumbnailUrl: `https://cdn/${id}-thumb.jpg`,
  metadata: { provider: "worldlabs", worldId: id, generatedAt: "2026-09-23T00:00:00Z" },
});

describe("gallery", () => {
  it("adds newest first, once per world, and exposes only card fields", async () => {
    const store = new MemoryStore();
    const a = await addToGallery(store, world("a"));
    await addToGallery(store, world("b"));
    await addToGallery(store, world("a"));
    const cards = await galleryCards(store);
    expect(cards.map((c) => c.photoUrl)).toEqual(["https://cdn/b.jpg", "https://cdn/a.jpg"]);
    expect(Object.keys(cards[0]).sort()).toEqual(["id", "photoUrl", "thumbnailUrl"]);
    expect((await getGalleryEntry(store, a?.id ?? ""))?.world.splatUrl).toBe("https://cdn/a.spz");
  });

  it("skips worlds without their photograph, and can remove entries", async () => {
    const store = new MemoryStore();
    expect(await addToGallery(store, { ...world("x"), sourcePhotoUrl: undefined })).toBeNull();
    const entry = await addToGallery(store, world("y"));
    expect(await removeFromGallery(store, entry?.id ?? "")).toBe(true);
    expect(await galleryCards(store)).toEqual([]);
  });
});
