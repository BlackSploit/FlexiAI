"use client";

import { useEffect, useRef, useState } from "react";
import { AlertOctagonIcon, CheckCircle2Icon, Volume2Icon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import { PHASE_LABEL, S } from "../../strings";
import type { AgentFeed } from "../../hooks/use-agent-events";
import type { useSendInput } from "../../hooks/use-send-input";

type Send = ReturnType<typeof useSendInput>;

const Bi = ({ t, className }: { t: { ml: string; en: string }; className?: string }) => (
  <span className={cn("flex flex-col leading-tight", className)}>
    <span lang="ml" className="font-ml">{t.ml}</span>
    <span className="text-[0.8em] opacity-80">{t.en}</span>
  </span>
);

/** Consent (§1.4 #7): no pose analysis until the patient agrees. Re-sent every 2 s until the phase moves on. */
export const ConsentBanner = ({ feed, send }: { feed: AgentFeed; send: Send }) => {
  const [agreed, setAgreed] = useState(false);
  useEffect(() => {
    if (!agreed || feed.phase !== "await_consent") return;
    const id = setInterval(() => void send({ type: "pc.consent", agreed: true }), 2000);
    return () => clearInterval(id);
  }, [agreed, feed.phase, send]);
  if (feed.phase !== "await_consent" && feed.phase !== "greeting") return null;
  return (
    <div className="rounded-lg bg-white text-foreground p-4 flex flex-col gap-y-3">
      <p className="font-medium"><Bi t={S.consentTitle} /></p>
      <p className="text-sm"><Bi t={S.consentBody} /></p>
      <Button size="lg" className="min-h-14 text-base" disabled={!feed.ready || agreed}
        onClick={() => {
          setAgreed(true);
          void send({ type: "pc.consent", agreed: true });
        }}>
        {agreed ? <CheckCircle2Icon /> : null}
        <Bi t={S.agree} />
      </Button>
    </div>
  );
};

/** Stop (§1.4 #8): enabled from the first render, before pc.ready; the backup path alerts the physio anyway. */
export const StopButton = ({ send, label = S.stop }: { send: Send; label?: { ml: string; en: string } }) => {
  const [sent, setSent] = useState(false);
  return (
    <div className="flex flex-col gap-y-1">
      <Button variant="destructive" className="min-h-16 text-lg font-semibold w-full"
        onClick={() => {
          setSent(true);
          void send({ type: "pc.stop", reason: "button" });
        }}>
        <AlertOctagonIcon className="size-6" />
        <Bi t={label} />
      </Button>
      {sent && <p className="text-sm text-center"><Bi t={S.physioAlerted} /></p>}
    </div>
  );
};

const PAIN_COLORS = ["#16a34a", "#22c55e", "#65a30d", "#84cc16", "#ca8a04", "#eab308", "#f59e0b", "#f97316", "#ea580c", "#dc2626", "#b91c1c"];

/** Pain 0-10. Highlighted when the coach asks; always usable; >= 7 stops the set. */
export const PainScale = ({ feed, send }: { feed: AgentFeed; send: Send }) => {
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => {
    if (feed.awaitingPain) setPicked(null);
  }, [feed.awaitingPain, feed.setIndex]);
  return (
    <div className={cn("rounded-lg bg-white text-foreground p-3 flex flex-col gap-y-2", feed.awaitingPain && "ring-4 ring-amber-400 animate-pulse")}>
      <p className="font-medium"><Bi t={S.painTitle} /></p>
      <div className="grid grid-cols-6 md:grid-cols-11 gap-1.5">
        {PAIN_COLORS.map((color, score) => (
          <button key={score} aria-label={`Pain ${score} of 10`}
            className={cn("min-h-12 rounded-md text-white text-lg font-semibold", picked === score && "ring-4 ring-black/60")}
            style={{ backgroundColor: color }}
            onClick={() => {
              setPicked(score);
              void send({ type: "pc.pain_score", score, setIndex: Math.max(1, feed.setIndex) });
            }}>
            {score}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground"><Bi t={S.painNone} /><Bi t={S.painWorst} className="text-right" /></div>
      {picked !== null && picked >= 7 && <p className="text-sm font-medium text-rose-700"><Bi t={S.physioAlerted} /></p>}
    </div>
  );
};

/** Symptoms always stop the set: sent on the FIRST tap; "undo" only clears the local badge. */
export const SymptomButtons = ({ send }: { send: Send }) => {
  const [last, setLast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const items = [["dizziness", S.dizziness], ["chest_pain", S.chestPain], ["sharp_pain", S.sharpPain]] as const;
  return (
    <div className="rounded-lg bg-white text-foreground p-3 flex flex-col gap-y-2">
      <p className="font-medium"><Bi t={S.symptomTitle} /></p>
      <div className="grid grid-cols-3 gap-2">
        {items.map(([kind, label]) => (
          <Button key={kind} variant="outline" className={cn("min-h-14 h-auto whitespace-normal", last === kind && "border-rose-600 bg-rose-50")}
            onClick={() => {
              void send({ type: "pc.symptom", kind });
              setLast(kind);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => setLast(null), 3000);
            }}>
            <Bi t={label} />
          </Button>
        ))}
      </div>
      {last && (
        <div className="flex items-center justify-between text-sm">
          <Bi t={S.physioAlerted} />
          <button className="underline" onClick={() => setLast(null)}><Bi t={S.undo} /></button>
        </div>
      )}
    </div>
  );
};

/** Last captions: Malayalam large; English for the physio always, for patients who prefer English. */
export const CaptionsPanel = ({ feed, showEnglish }: { feed: AgentFeed; showEnglish: boolean }) => (
  <div aria-live="polite" className="rounded-lg bg-black/60 text-white p-3 flex flex-col gap-y-2 min-h-24">
    {feed.captions.slice(-4).map((c, i) => (
      <div key={`${c.id}-${i}`} className={cn(c.kind === "safety" && "text-rose-300")}>
        <p lang="ml" className="text-xl font-ml leading-relaxed">{c.ml}</p>
        {showEnglish && c.en && <p className="text-sm opacity-80">{c.en}</p>}
      </div>
    ))}
  </div>
);

export const PhaseIndicator = ({ feed }: { feed: AgentFeed }) => {
  const label = PHASE_LABEL[feed.phase];
  if (!label) return null;
  return (
    <span className={cn("rounded-full px-3 py-1 text-sm font-medium bg-black/70 text-white", feed.phase === "halted" && "bg-rose-600")}>
      <span lang="ml" className="font-ml">{label.ml}</span> · {label.en}
      {feed.setsPlanned > 1 && feed.setIndex > 0 && ` · ${feed.setIndex}/${feed.setsPlanned}`}
    </span>
  );
};

export const RepCounter = ({ feed, repsPlanned }: { feed: AgentFeed; repsPlanned: number }) => {
  const r = feed.lastRep;
  const warn = !!r && (r.tooFast || r.peak < r.target - 8);
  if (feed.phase !== "set" && !r) return null;
  return (
    <span key={r?.n ?? 0} className={cn("rounded-xl px-4 py-2 text-3xl font-bold bg-black/70 text-white transition-colors",
      warn && "bg-amber-500")}>
      {r?.n ?? 0} / {repsPlanned}
    </span>
  );
};

/** iOS Safari may block autoplay; the installed SDK (1.18) has no useIsAutoplayBlocked, so replay the audio elements. */
export const AutoplayUnblock = () => (
  <button className="rounded-full bg-black/70 text-white px-3 py-1 text-xs flex items-center gap-1"
    onClick={() => document.querySelectorAll("audio").forEach((a) => void a.play().catch(() => undefined))}>
    <Volume2Icon className="size-3.5" />
    <span lang="ml" className="font-ml">{S.enableSound.ml}</span> · {S.enableSound.en}
  </button>
);
