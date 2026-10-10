import { PAIN_ALERT_THRESHOLD } from "@/constants";
import { Badge } from "@/components/ui/badge";

export const PainBadge = ({ pain }: { pain: number | null | undefined }) => {
  if (pain === null || pain === undefined) return null;
  return <Badge variant={pain >= PAIN_ALERT_THRESHOLD ? "destructive" : "outline"}>pain {pain}/10</Badge>;
};
