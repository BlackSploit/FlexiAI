import "server-only";

import { StreamClient } from "@stream-io/node-sdk";

import { lazy } from "@/lib/lazy";

export const streamVideo = lazy(() => new StreamClient(
  process.env.NEXT_PUBLIC_STREAM_VIDEO_API_KEY!,
  process.env.STREAM_VIDEO_SECRET_KEY!
));
