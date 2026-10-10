"use client";

import { LoaderIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Call,
  CallingState,
  StreamCall,
  StreamVideo,
  StreamVideoClient,
} from "@stream-io/video-react-sdk";

import "@stream-io/video-react-sdk/dist/css/styles.css";

import type { CallInfo, CallUser } from "../../types";
import { CallUI } from "./call-ui";

interface Props {
  info: CallInfo;
  user: CallUser;
  /** Physio: user token from sessions.physioToken. Patient: call-scoped token from join.streamToken. */
  tokenProvider: () => Promise<string>;
};

export const Loading = () => (
  <div className="flex h-full items-center justify-center bg-radial from-sidebar-accent to-sidebar">
    <LoaderIcon className="size-6 animate-spin text-white" />
  </div>
);

export const CallConnect = ({ info, user, tokenProvider }: Props) => {
  // The provider identity changes on every render of the parent; keep the latest in a ref so the client
  // is only rebuilt when the user changes.
  const providerRef = useRef(tokenProvider);
  useEffect(() => {
    providerRef.current = tokenProvider;
  }, [tokenProvider]);

  const [client, setClient] = useState<StreamVideoClient>();
  useEffect(() => {
    const _client = new StreamVideoClient({
      apiKey: process.env.NEXT_PUBLIC_STREAM_VIDEO_API_KEY!,
      user: { id: user.id, name: user.name, image: user.image },
      tokenProvider: () => providerRef.current(),
    });
    setClient(_client);
    return () => {
      void _client.disconnectUser();
      setClient(undefined);
    };
  }, [user.id, user.name, user.image]);

  const [call, setCall] = useState<Call>();
  useEffect(() => {
    if (!client) return;
    const _call = client.call(info.callType, info.streamCallId);
    setCall(_call);
    return () => {
      // Leave only: unmounting (a refresh, a closed tab) must never end the call for everyone.
      if (_call.state.callingState !== CallingState.LEFT) void _call.leave().catch(() => undefined);
      setCall(undefined);
    };
  }, [client, info.callType, info.streamCallId]);

  if (!client || !call) return <Loading />;

  return (
    <StreamVideo client={client}>
      <StreamCall call={call}>
        <CallUI info={info} />
      </StreamCall>
    </StreamVideo>
  );
};
