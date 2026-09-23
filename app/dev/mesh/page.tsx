import { notFound } from "next/navigation";
import { MeshCompare } from "./MeshCompare";

/** Dev tool: side-by-side GLB previews. /dev/mesh?files=a.glb,b.glb&angle=0.6 */
export default function MeshPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <MeshCompare />;
}
