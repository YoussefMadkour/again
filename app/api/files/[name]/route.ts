import { readLocalFile } from "@/lib/ai/providers/local-storage";

export const runtime = "nodejs";

const TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  jpg: "image/jpeg",
  glb: "model/gltf-binary",
};

/** Serves LocalStorage files in development. */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  if (process.env.VERCEL) return new Response("not found", { status: 404 });
  const { name } = await params;
  const bytes = await readLocalFile(`/api/files/${name}`);
  if (!bytes) return new Response("not found", { status: 404 });
  const type = TYPES[name.split(".").pop() ?? ""] ?? "application/octet-stream";
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
