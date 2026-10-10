import "server-only";

import { StreamChat } from "stream-chat";

import { lazy } from "@/lib/lazy";

export const streamChat = lazy(() => StreamChat.getInstance(
  process.env.NEXT_PUBLIC_STREAM_CHAT_API_KEY!,
  process.env.STREAM_CHAT_SECRET_KEY!
));
