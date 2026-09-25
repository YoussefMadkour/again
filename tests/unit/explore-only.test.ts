import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST } from "@/app/api/world/route";
import { publicConfig } from "@/lib/config";

describe("explore-only showcase", () => {
  afterEach(() => {
    delete process.env.EXPLORE_ONLY;
  });

  it("refuses to make a memory, before reading anything", async () => {
    process.env.EXPLORE_ONLY = "true";
    const form = new FormData();
    form.set("photo", new File([new Uint8Array(8)], "photo.jpg", { type: "image/jpeg" }));
    const res = await POST(new Request("http://x/api/world", { method: "POST", body: form }));
    expect(res.status).toBe(403);
    expect(publicConfig().exploreOnly).toBe(true);
  });

  it("is off unless set", () => {
    expect(publicConfig().exploreOnly).toBe(false);
  });
});
