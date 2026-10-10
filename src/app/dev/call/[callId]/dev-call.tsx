"use client";

import { nanoid } from "nanoid";
import { useEffect, useState } from "react";
import {
  Call,
  ParticipantView,
  StreamCall,
  StreamTheme,
  StreamVideo,
  StreamVideoClient,
  useCallStateHooks,
  type CustomVideoEvent,
} from "@stream-io/video-react-sdk";

import "@stream-io/video-react-sdk/dist/css/styles.css";

interface Props {
  apiKey: string;
  callType: string;
  callId: string;
  user: { id: string; name: string };
  token: string;
  agentUserId: string;
}

type LogLine = { at: string; text: string };

const envelope = (type: string, fields: Record<string, unknown>) =>
  ({ type, v: 1, eventId: nanoid(), ts: Date.now(), ...fields });

export const DevCall = ({ apiKey, callType, callId, user, token, agentUserId }: Props) => {
  const [client, setClient] = useState<StreamVideoClient>();
  const [call, setCall] = useState<Call>();
  const [log, setLog] = useState<LogLine[]>([]);
  const add = (text: string) =>
    setLog((l) => [{ at: new Date().toLocaleTimeString(), text }, ...l].slice(0, 40));

  useEffect(() => {
    const c = new StreamVideoClient({ apiKey, user, token });
    setClient(c);
    return () => {
      c.disconnectUser();
      setClient(undefined);
    };
  }, [apiKey, user, token]);

  useEffect(() => {
    if (!client) return;
    const c = client.call(callType, callId);
    setCall(c);
    const off = c.on("custom", (e) => {
      const ev = e as CustomVideoEvent;
      const data = ev.custom as { type?: string; ts?: number };
      const delay = data.ts ? `${Date.now() - data.ts} ms` : "?";
      add(`← ${data.type ?? "custom"} from ${ev.user?.id}${ev.user?.id === agentUserId ? " (agent)" : ""} [${delay}] ${JSON.stringify(data)}`);
    });
    c.join({ create: false })
      .then(async () => {
        add(`joined ${callType}:${callId} as ${user.id}`);
        await c.camera.enable();
        await c.microphone.disable();
      })
      .catch((err) => add(`join failed: ${String(err)}`));
    return () => {
      off();
      c.leave().catch(() => undefined);   // leave only: never end the call for everyone
      setCall(undefined);
    };
  }, [client, callType, callId, user.id, agentUserId]);

  const send = async (type: string, fields: Record<string, unknown>) => {
    if (!call) return;
    try {
      await call.sendCustomEvent(envelope(type, fields));
      add(`→ ${type} sent`);
    } catch (err) {
      add(`→ ${type} FAILED: ${String(err)}`);
    }
  };

  if (!client || !call) return <div className="p-6">Connecting…</div>;

  return (
    <StreamVideo client={client}>
      <StreamCall call={call}>
        <StreamTheme className="min-h-dvh bg-neutral-950 p-4 text-white">
          <div className="grid gap-4 md:grid-cols-[1fr_380px]">
            <Tiles agentUserId={agentUserId} />
            <div className="flex flex-col gap-3">
              <p className="text-sm text-neutral-400">Dev Spike A · {user.id}</p>
              <div className="flex flex-wrap gap-2">
                <button className="rounded bg-green-600 px-3 py-2" onClick={() => send("pc.consent", { agreed: true })}>
                  pc.consent
                </button>
                <button className="rounded bg-red-600 px-3 py-2" onClick={() => send("pc.stop", { reason: "button" })}>
                  pc.stop
                </button>
                <button className="rounded bg-amber-600 px-3 py-2" onClick={() => send("pc.pain_score", { score: 7, setIndex: 1 })}>
                  pain 7
                </button>
              </div>
              <ol className="max-h-[70dvh] overflow-auto rounded bg-neutral-900 p-2 font-mono text-xs">
                {log.map((l, i) => <li key={i}>{l.at} {l.text}</li>)}
              </ol>
            </div>
          </div>
        </StreamTheme>
      </StreamCall>
    </StreamVideo>
  );
};

const Tiles = ({ agentUserId }: { agentUserId: string }) => {
  const { useParticipants } = useCallStateHooks();
  const participants = useParticipants();
  const agent = participants.find((p) => p.userId === agentUserId);
  const others = participants.filter((p) => p.userId !== agentUserId);
  return (
    <div className="flex flex-col gap-3">
      <div className="aspect-video overflow-hidden rounded bg-black">
        {agent ? <ParticipantView participant={agent} /> : <p className="p-6">Coach is not in the call yet…</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {others.map((p) => (
          <div key={p.sessionId} className="aspect-video overflow-hidden rounded bg-black">
            <ParticipantView participant={p} muteAudio={p.isLocalParticipant} />
          </div>
        ))}
      </div>
    </div>
  );
};
