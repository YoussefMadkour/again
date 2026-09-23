import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { FileStorage } from "@/lib/ai/types";

/**
 * Development only: files under .data/files, served by /api/files/<name>. Remote models can't
 * fetch these URLs, so real vision/3D need FalStorage; sound works fine with this.
 */
const DIR = join(process.cwd(), ".data", "files");
const PREFIX = "/api/files/";

export class LocalStorage implements FileStorage {
  async upload(bytes: Uint8Array<ArrayBuffer>, _contentType: string, fileName: string) {
    await mkdir(DIR, { recursive: true });
    const name = basename(fileName);
    await writeFile(join(DIR, name), bytes);
    return `${PREFIX}${name}`;
  }
}

export async function readLocalFile(url: string): Promise<Buffer | null> {
  if (!url.startsWith(PREFIX)) return null;
  return readFile(join(DIR, basename(url.slice(PREFIX.length)))).catch(() => null);
}
