import { notFound } from "next/navigation";
import { CaptureView } from "./CaptureView";

/** Dev tool: renders the world from the original camera so we can make the demo photo. */
export default function CapturePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CaptureView />;
}
