"use client";

import { PlanLibrary } from "@/components/library/plan-library";

/** Start a plan from a LiDAR scan or a blank page, and continue the ones not finished yet. */
export default function SkannarePage() {
  return <PlanLibrary mode="scans" />;
}
