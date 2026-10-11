import "dotenv/config";

/**
 * npm run stream:call-type              DRY RUN: read the `default` grants, print the planned `physio_session` type
 * npm run stream:call-type -- --apply   create (or update) `physio_session` in Stream (ask the user first, §12 #5)
 *
 * §7.3 [U]: the grant list is hand-written, so every event/reaction capability the `default` type gives
 * call_member/user is copied into call_member; otherwise patient consent/Stop/pain custom events would 403
 * and only the backup tRPC path would work. Keep STREAM_CALL_TYPE=default until the dashboard confirms
 * `user` lacks join-call/create-call on physio_session and the Spike A custom-event smoke test passes.
 */
import { streamVideo } from "../src/lib/stream-video";

const NAME = "physio_session";
const apply = process.argv.includes("--apply");

const BASE_GRANTS: Record<string, string[]> = {
  // Stream adds a `guest` role with join/send rights by default; anyone holding the public API key can mint a
  // guest user, so it gets nothing here.
  guest: [],
  user: ["read-call"],
  call_member: ["read-call", "join-call", "send-audio", "send-video"],
  admin: ["read-call", "join-call", "send-audio", "send-video", "end-call", "update-call-member"],
};

const isEventCapability = (c: string) => /event|reaction/.test(c);

async function main() {
  const def = await streamVideo.video.getCallType({ name: "default" });
  const copied = [...new Set([...(def.grants.call_member ?? []), ...(def.grants.user ?? [])].filter(isEventCapability))];
  const grants = {
    ...BASE_GRANTS,
    call_member: [...new Set([...BASE_GRANTS.call_member, ...copied])],
    admin: [...new Set([...BASE_GRANTS.admin, ...copied])],
  };
  const settings = {
    recording: { mode: "disabled" as const },
    transcription: { mode: "disabled" as const, closed_caption_mode: "disabled" as const },
    frame_recording: { mode: "disabled" as const, capture_interval_in_seconds: 5 },
    backstage: { enabled: false },
  };

  console.log("default grants (call_member):", def.grants.call_member ?? []);
  console.log("default grants (user):", def.grants.user ?? []);
  console.log("event/reaction capabilities copied:", copied.length ? copied : "(none)");
  console.log(`planned ${NAME} grants:`, JSON.stringify(grants, null, 2));

  if (!apply) {
    console.log("\nDry run only. Re-run with --apply to write the call type.");
    return;
  }

  const existing = await streamVideo.video.getCallType({ name: NAME }).catch(() => null);
  if (existing) {
    await streamVideo.video.updateCallType({ name: NAME, grants, settings });
    console.log(`updated ${NAME}`);
  } else {
    await streamVideo.video.createCallType({ name: NAME, grants, settings });
    console.log(`created ${NAME}`);
  }
  const after = await streamVideo.video.getCallType({ name: NAME });
  console.log("verified grants:", JSON.stringify(after.grants, null, 2));
  console.log("recording:", after.settings.recording.mode, "| transcription:", after.settings.transcription.mode);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
