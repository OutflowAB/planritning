import { notFound } from "next/navigation";

import { AnimationPreview } from "@/components/dashboard/processing/animation-preview";

/** Development only: try the processing animations without paying for a generation. */
export default function ForhandsvisningPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <AnimationPreview />;
}
