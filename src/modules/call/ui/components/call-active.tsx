import type { CallInfo } from "../../types";
import { GuidedCallLayout } from "./guided-call-layout";

interface Props {
  info: CallInfo;
  onLeave: () => void;
  onEndForAll?: () => void;
};

export const CallActive = (props: Props) => <GuidedCallLayout {...props} />;
