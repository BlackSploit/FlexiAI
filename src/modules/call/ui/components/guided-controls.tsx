"use client";

import { useEffect, useRef, useState } from "react";
import {
  ActivityIcon, AlertOctagonIcon, CheckCircle2Icon, HeartPulseIcon, LoaderIcon, MicIcon, MicOffIcon, PhoneOffIcon,
  ShieldCheckIcon, VideoIcon, VideoOffIcon, Volume2Icon,
} from "lucide-react";
import { useCallStateHooks } from "@stream-io/video-react-sdk";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import { PHASE_LABEL, S } from "../../strings";
import type { AgentFeed } from "../../hooks/use-agent-events";
import type { useSendInput } from "../../hooks/use-send-input";
import { Bi } from "./call-brand";

type Send = ReturnType<typeof useSendInput>;

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
    <div
      role="dialog" aria-modal="false" aria-labelledby="consent-title"
      className="absolute inset-0 z-20 flex items-end justify-center overflow-y-auto bg-neutral-950/75 p-3 backdrop-blur-sm animate-in fade-in sm:items-center sm:p-6"
    >
      <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl border bg-card p-5 text-card-foreground shadow-2xl animate-in slide-in-from-bottom-4 sm:p-6">
        <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ShieldCheckIcon className="size-6" aria-hidden />
        </span>
        <h2 id="consent-title" className="font-semibold">
          <Bi t={S.consentTitle} mlClassName="text-xl leading-snug" enClassName="mt-1 text-sm text-muted-foreground opacity-100" />
        </h2>
        <p className="text-sm">
          <Bi t={S.consentBody} mlClassName="text-base leading-relaxed" enClassName="mt-1 text-muted-foreground opacity-100" />
        </p>
        <Button size="lg" className="min-h-16 w-full rounded-xl text-lg font-semibold" disabled={!feed.ready || agreed}
          onClick={() => {
            setAgreed(true);
            void send({ type: "pc.consent", agreed: true });
          }}>
          {agreed ? <CheckCircle2Icon className="size-6" /> : !feed.ready ? <LoaderIcon className="size-5 animate-spin" /> : null}
          <Bi t={agreed ? S.agreedWaiting : S.agree} className="items-start" enClassName="text-sm font-normal" />
        </Button>
      </div>
    </div>
  );
};

/** Stop (§1.4 #8): enabled from the first render, before pc.ready; the backup path alerts the physio anyway. */
export const StopButton = ({ send, label = S.stop, className }: {
  send: Send; label?: { ml: string; en: string }; className?: string;
}) => {
  const [sent, setSent] = useState(false);
  return (
    <div className={cn("flex flex-col gap-y-1.5", className)}>
      <Button variant="destructive"
        className="min-h-16 w-full rounded-xl bg-rose-600 px-3 text-lg font-semibold text-white shadow-lg shadow-rose-950/40 hover:bg-rose-700 focus-visible:ring-rose-400/60 active:scale-[0.99]"
        onClick={() => {
          setSent(true);
          void send({ type: "pc.stop", reason: "button" });
        }}>
        <AlertOctagonIcon className="size-6 sm:size-7" aria-hidden />
        <Bi t={label} className="items-start" mlClassName="text-xl" enClassName="text-sm font-medium" />
      </Button>
      {sent && (
        <p role="status" className="flex items-center justify-center gap-2 text-center text-sm text-white">
          <CheckCircle2Icon className="size-4 text-emerald-400" aria-hidden />
          <span lang="ml" className="font-ml">{S.physioAlerted.ml}</span>
          <span className="text-white/70">· {S.physioAlerted.en}</span>
        </p>
      )}
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
    <section
      aria-labelledby="pain-title"
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-shadow",
        feed.awaitingPain && "ring-4 ring-amber-400 shadow-amber-500/30 shadow-lg",
      )}
    >
      {feed.awaitingPain && (
        <p className="flex items-center gap-2 rounded-lg bg-amber-500/15 px-3 py-2 text-sm font-medium text-amber-800 dark:text-amber-200">
          <span className="relative flex size-2.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-500 opacity-75" /><span className="relative inline-flex size-2.5 rounded-full bg-amber-500" /></span>
          <span lang="ml" className="font-ml">{S.painNow.ml}</span>
        </p>
      )}
      <h3 id="pain-title" className="flex items-center gap-2 font-semibold">
        <HeartPulseIcon className="size-5 shrink-0 text-rose-500" aria-hidden />
        <Bi t={S.painTitle} mlClassName="text-lg" enClassName="text-sm font-normal text-muted-foreground opacity-100" />
      </h3>
      <div className="grid grid-cols-6 gap-1.5" role="group" aria-label="Pain score from 0 to 10">
        {PAIN_COLORS.map((color, score) => (
          <button key={score} type="button" aria-label={`Pain ${score} of 10`} aria-pressed={picked === score}
            className={cn(
              "min-h-12 rounded-lg text-lg font-bold text-white shadow-sm transition-transform outline-none",
              "focus-visible:ring-4 focus-visible:ring-ring/60 active:scale-95",
              picked === score && "scale-105 ring-4 ring-foreground/70",
              picked !== null && picked !== score && "opacity-60",
            )}
            style={{ backgroundColor: color }}
            onClick={() => {
              setPicked(score);
              void send({ type: "pc.pain_score", score, setIndex: Math.max(1, feed.setIndex) });
            }}>
            {score}
          </button>
        ))}
      </div>
      <div className="flex justify-between gap-4 text-xs text-muted-foreground">
        <Bi t={S.painNone} /><Bi t={S.painWorst} className="text-right" />
      </div>
      {picked !== null && (
        <p role="status" className={cn("flex items-center gap-2 text-sm font-medium",
          picked >= 7 ? "text-rose-700 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-300")}>
          <CheckCircle2Icon className="size-4 shrink-0" aria-hidden />
          {picked >= 7 ? <Bi t={S.physioAlerted} /> : <span>{picked} / 10</span>}
        </p>
      )}
    </section>
  );
};

/** Symptoms always stop the set: sent on the FIRST tap; "undo" only clears the local badge. */
export const SymptomButtons = ({ send }: { send: Send }) => {
  const [last, setLast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const items = [["dizziness", S.dizziness], ["chest_pain", S.chestPain], ["sharp_pain", S.sharpPain]] as const;
  return (
    <section aria-labelledby="symptom-title" className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
      <h3 id="symptom-title" className="flex items-center gap-2 font-semibold">
        <ActivityIcon className="size-5 shrink-0 text-rose-500" aria-hidden />
        <Bi t={S.symptomTitle} mlClassName="text-lg" enClassName="text-sm font-normal text-muted-foreground opacity-100" />
      </h3>
      <div className="grid grid-cols-3 gap-2">
        {items.map(([kind, label]) => (
          <Button key={kind} variant="outline" aria-pressed={last === kind}
            className={cn("h-auto min-h-16 whitespace-normal rounded-xl px-2 py-2 text-center",
              last === kind && "border-rose-600 bg-rose-500/10 text-rose-700 dark:text-rose-300")}
            onClick={() => {
              void send({ type: "pc.symptom", kind });
              setLast(kind);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => setLast(null), 3000);
            }}>
            <Bi t={label} className="min-w-0 items-center [overflow-wrap:anywhere]" mlClassName="text-sm sm:text-base" enClassName="text-xs" />
          </Button>
        ))}
      </div>
      {last && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm">
          <Bi t={S.physioAlerted} />
          <button type="button" className="min-h-11 rounded-md px-2 font-medium underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onClick={() => setLast(null)}>
            <Bi t={S.undo} />
          </button>
        </div>
      )}
    </section>
  );
};

/** Patient captions: a bottom sheet over the coach video, Malayalam large. */
export const CaptionsSheet = ({ feed, showEnglish }: { feed: AgentFeed; showEnglish: boolean }) => {
  const recent = feed.captions.slice(-2);
  if (recent.length === 0) return null;
  return (
    <div aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-neutral-950 via-neutral-950/85 to-transparent px-3 pb-3 pt-10 sm:px-5 sm:pb-5">
      <div className="mx-auto flex max-w-2xl flex-col gap-2">
        {recent.map((c, i) => {
          const latest = i === recent.length - 1;
          return (
            <div key={`${c.id}-${feed.captions.length - recent.length + i}`}
              className={cn("rounded-xl px-3 py-2 transition-opacity animate-in fade-in slide-in-from-bottom-2",
                latest ? "bg-white/10 backdrop-blur-md" : "opacity-50",
                c.kind === "safety" && "bg-rose-600/80 opacity-100")}>
              <p lang="ml" className={cn("font-ml leading-relaxed text-white", latest ? "text-xl sm:text-2xl" : "text-base")}>{c.ml}</p>
              {showEnglish && c.en && <p className="text-sm text-white/75">{c.en}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** Physio transcript: last captions with English. */
export const CaptionsPanel = ({ feed, showEnglish }: { feed: AgentFeed; showEnglish: boolean }) => (
  <section aria-label="Coach captions" className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-4">
    <h3 className="text-xs font-medium uppercase tracking-wider text-white/60">Coach is saying</h3>
    <div aria-live="polite" className="flex min-h-16 flex-col gap-2">
      {feed.captions.length === 0 && <p className="text-sm text-white/50">Captions appear here as the coach speaks.</p>}
      {feed.captions.slice(-4).map((c, i, arr) => (
        <div key={`${c.id}-${i}`} className={cn("border-l-2 pl-3", i === arr.length - 1 ? "border-primary" : "border-white/15 opacity-60",
          c.kind === "safety" && "border-rose-500 text-rose-300 opacity-100")}>
          <p lang="ml" className="font-ml leading-relaxed">{c.ml}</p>
          {showEnglish && c.en && <p className="text-sm text-white/70">{c.en}</p>}
        </div>
      ))}
    </div>
  </section>
);

export const PhaseIndicator = ({ feed }: { feed: AgentFeed }) => {
  const label = PHASE_LABEL[feed.phase];
  if (!label) return null;
  const live = feed.phase === "set";
  return (
    <span className={cn(
      "inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium text-white shadow-lg ring-1 backdrop-blur-md",
      feed.phase === "halted" ? "bg-rose-600/90 ring-rose-400/40" : feed.phase === "await_pain" ? "bg-amber-500/90 ring-amber-300/40"
        : feed.phase === "done" ? "bg-primary/90 ring-white/20" : "bg-neutral-900/70 ring-white/15",
    )}>
      {live && <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex size-2 rounded-full bg-emerald-400" /></span>}
      <span lang="ml" className="font-ml truncate">{label.ml}</span>
      <span className="hidden text-white/75 min-[400px]:inline">· {label.en}</span>
      {feed.setsPlanned > 1 && feed.setIndex > 0 && (
        <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs tabular-nums">{S.set.en} {feed.setIndex}/{feed.setsPlanned}</span>
      )}
    </span>
  );
};

/** Big rep counter; re-keyed on each rep so it pops. Amber when the last rep was short or rushed. */
export const RepCounter = ({ feed, repsPlanned }: { feed: AgentFeed; repsPlanned: number }) => {
  const r = feed.lastRep;
  const warn = !!r && (r.tooFast || r.peak < r.target - 8);
  if (feed.phase !== "set" && !r) return null;
  const n = r?.n ?? 0;
  const pct = Math.min(100, Math.round((n / Math.max(1, repsPlanned)) * 100));
  return (
    <div className={cn(
      "flex min-w-24 flex-col gap-1 rounded-2xl px-4 py-2.5 text-white shadow-xl ring-1 backdrop-blur-md transition-colors duration-300",
      warn ? "bg-amber-500/90 ring-amber-300/50" : "bg-neutral-900/75 ring-white/15",
    )}>
      <span className="text-[11px] font-medium uppercase tracking-wider text-white/75">
        <span lang="ml" className="font-ml normal-case tracking-normal">{S.reps.ml}</span> · {S.reps.en}
      </span>
      <span className="flex items-baseline gap-1 tabular-nums">
        <span key={n} className="text-5xl font-bold leading-none animate-in zoom-in-50 fade-in duration-300">{n}</span>
        <span className="text-lg font-medium text-white/70">/ {repsPlanned}</span>
      </span>
      <span className="h-1.5 w-full overflow-hidden rounded-full bg-white/20" aria-hidden>
        <span className={cn("block h-full rounded-full transition-[width] duration-500", warn ? "bg-white" : "bg-emerald-400")} style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
};

/** iOS Safari may block autoplay; the installed SDK (1.18) has no useIsAutoplayBlocked, so replay the audio elements. */
export const AutoplayUnblock = () => (
  <button type="button" aria-label={`${S.enableSound.en}`}
    className="flex min-h-11 items-center gap-2 rounded-full bg-white/10 px-3 text-xs text-white ring-1 ring-white/15 outline-none transition-colors hover:bg-white/15 focus-visible:ring-[3px] focus-visible:ring-ring/60"
    onClick={() => document.querySelectorAll("audio").forEach((a) => void a.play().catch(() => undefined))}>
    <Volume2Icon className="size-4" aria-hidden />
    <span lang="ml" className="font-ml sm:hidden">{S.sound.ml}</span>
    <span className="hidden sm:inline"><span lang="ml" className="font-ml">{S.enableSound.ml}</span> · {S.enableSound.en}</span>
  </button>
);

const RoundControl = ({ label, onClick, children, danger, off, disabled }: {
  label: string; onClick: () => void; children: React.ReactNode; danger?: boolean; off?: boolean; disabled?: boolean;
}) => (
  <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
    className={cn(
      "flex size-11 shrink-0 items-center justify-center rounded-full outline-none sm:size-12 transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/60 disabled:opacity-50",
      danger ? "bg-white/10 text-rose-300 ring-1 ring-white/15 hover:bg-rose-600 hover:text-white"
        : off ? "bg-white text-neutral-900 hover:bg-white/90" : "bg-white/10 text-white ring-1 ring-white/15 hover:bg-white/20",
    )}>
    {children}
  </button>
);

/** Compact mic / camera / leave controls (Stream's CallControls is too wide for a 360px phone). */
export const MediaControls = ({ onLeave }: { onLeave: () => void }) => {
  const { useMicrophoneState, useCameraState } = useCallStateHooks();
  const mic = useMicrophoneState();
  const cam = useCameraState();
  return (
    <div className="flex items-center gap-2">
      <RoundControl label={mic.optimisticIsMute ? "Unmute microphone" : "Mute microphone"} off={mic.optimisticIsMute}
        disabled={mic.isTogglePending} onClick={() => void mic.microphone.toggle()}>
        {mic.optimisticIsMute ? <MicOffIcon className="size-5" /> : <MicIcon className="size-5" />}
      </RoundControl>
      <RoundControl label={cam.optimisticIsMute ? "Turn camera on" : "Turn camera off"} off={cam.optimisticIsMute}
        disabled={cam.isTogglePending} onClick={() => void cam.camera.toggle()}>
        {cam.optimisticIsMute ? <VideoOffIcon className="size-5" /> : <VideoIcon className="size-5" />}
      </RoundControl>
      <RoundControl label="Leave call" danger onClick={onLeave}>
        <PhoneOffIcon className="size-5" />
      </RoundControl>
    </div>
  );
};
