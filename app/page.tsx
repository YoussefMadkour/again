import { Experience } from "@/components/experience/Experience";
import { accessPolicyFromEnv } from "@/lib/access";
import { publicConfig } from "@/lib/config";
import { galleryCards } from "@/lib/gallery";
import { getStore } from "@/lib/store";

// The gallery changes as people share memories.
export const dynamic = "force-dynamic";

export default async function Page() {
  const config = publicConfig();
  const gallery = await galleryCards(getStore()).catch((error) => {
    console.error("[gallery] unavailable", error);
    return [];
  });
  return (
    <Experience
      gallery={gallery}
      access={{
        requireCode: accessPolicyFromEnv().requireCode,
        ownerKey: config.ownerKey,
        contactUrl: config.contactUrl,
      }}
    />
  );
}
