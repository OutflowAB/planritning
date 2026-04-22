import { NextResponse } from "next/server";

import { getFloorplanJob, onJobEvent } from "@/lib/floorplan-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const job = getFloorplanJob(jobId);
  const encoder = new TextEncoder();

  if (!job) {
    return NextResponse.json({ error: "Unknown job" }, { status: 404 });
  }

  let releaseListener: (() => void) | null = null;
  let stopHeartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (value: string) => {
        try {
          controller.enqueue(encoder.encode(value));
        } catch {
          // Stream already closed.
        }
      };

      stopHeartbeat = setInterval(() => {
        safeEnqueue("event: heartbeat\ndata: ping\n\n");
      }, 15000);

      const release = onJobEvent(jobId, (event) => {
        if (event.type === "log") {
          safeEnqueue(`event: log\ndata: ${event.data}\n\n`);
        }

        if (event.type === "done") {
          safeEnqueue(`event: done\ndata: ${event.data}\n\n`);
          if (stopHeartbeat) {
            clearInterval(stopHeartbeat);
          }
          releaseListener?.();
          controller.close();
        }

        if (event.type === "error") {
          safeEnqueue(`event: error\ndata: ${event.data}\n\n`);
          if (stopHeartbeat) {
            clearInterval(stopHeartbeat);
          }
          releaseListener?.();
          controller.close();
        }
      });
      releaseListener = release;

      if (!release) {
        if (stopHeartbeat) {
          clearInterval(stopHeartbeat);
        }
        safeEnqueue("event: error\ndata: Unknown job\n\n");
        controller.close();
      }
    },
    cancel() {
      if (stopHeartbeat) {
        clearInterval(stopHeartbeat);
      }
      releaseListener?.();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
