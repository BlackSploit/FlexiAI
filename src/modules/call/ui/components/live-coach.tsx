"use client";

import { useEffect, useRef } from "react";
import { MicOffIcon, SparklesIcon, UserIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { S } from "../../strings";
import type { VoiceState } from "../../contracts";
import type { AgentFeed, TranscriptItem } from "../../hooks/use-agent-events";

/* ------------------------------------------------------------------------------------------------
 * Live AI coach UI (OpenAI Realtime). Purely presentational: it reads the agent feed and never sends
 * anything. Safety controls (Stop, pain, symptoms) live in guided-controls.tsx and are not touched here.
 * ---------------------------------------------------------------------------------------------- */

/** The feed's live-coach slice (pc.transcript / pc.voice, reduced in use-agent-events). */
export const readLiveCoach = ({ transcript, voice, liveCoach }: AgentFeed) => ({ transcript, voice, liveCoach });

/** Phases where the coach is muted and only the recorded count clips play. */
export const isQuietPhase = (phase: string) => phase === "countdown" || phase === "set";

const ML_RE = /[ഀ-ൿ]/;
const isMalayalam = (t: TranscriptItem) => t.lang === "ml" || (t.lang === undefined && ML_RE.test(t.text));

const VOICE_LABEL: Record<VoiceState, { ml: string; en: string }> = {
  off: S.voiceOff, listening: S.voiceListening, thinking: S.voiceThinking, speaking: S.voiceSpeaking,
};

/* Keyframes for the orb and typing dots. React 19 hoists and de-duplicates <style href precedence>. */
const LIVE_COACH_CSS = `
@keyframes pc-breathe{0%,100%{transform:scale(1);opacity:.55}50%{transform:scale(1.28);opacity:0}}
@keyframes pc-core{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
@keyframes pc-spin{to{transform:rotate(360deg)}}
@keyframes pc-shimmer{0%{background-position:150% 0}100%{background-position:-50% 0}}
@keyframes pc-bar{0%,100%{transform:scaleY(.3)}50%{transform:scaleY(1)}}
@keyframes pc-ripple{0%{transform:scale(1);opacity:.45}100%{transform:scale(1.75);opacity:0}}
@keyframes pc-dot{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
.pc-breathe{animation:pc-breathe 2.6s ease-in-out infinite}
.pc-core{animation:pc-core 2.6s ease-in-out infinite}
.pc-spin{animation:pc-spin 1.6s linear infinite}
.pc-shimmer{background-size:200% 100%;animation:pc-shimmer 1.8s linear infinite}
.pc-bar{transform-origin:center;animation:pc-bar .9s ease-in-out infinite}
.pc-ripple{animation:pc-ripple 1.6s ease-out infinite}
.pc-dot{animation:pc-dot 1.2s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.pc-breathe,.pc-core,.pc-spin,.pc-shimmer,.pc-bar,.pc-ripple,.pc-dot{animation:none!important}}
`;

const LiveCoachStyles = () => (
  <style href="physiocoach-live-coach" precedence="default">{LIVE_COACH_CSS}</style>
);

/* Five bars with uneven timings so "speaking" reads as audio, not a metronome. */
const BARS = [
  { h: "45%", d: "0.82s", delay: "-0.2s" },
  { h: "75%", d: "1.04s", delay: "-0.5s" },
  { h: "100%", d: "0.74s", delay: "-0.1s" },
  { h: "70%", d: "1.16s", delay: "-0.7s" },
  { h: "50%", d: "0.9s", delay: "-0.35s" },
];

const TypingDots = ({ className }: { className?: string }) => (
  <span className={cn("inline-flex items-center gap-1 align-middle", className)} aria-hidden>
    {[0, 0.15, 0.3].map((d) => (
      <span key={d} className="pc-dot size-1.5 rounded-full bg-current" style={{ animationDelay: `${d}s` }} />
    ))}
  </span>
);

/** The coach's voice state as an animated orb: listening pulses, thinking shimmers and spins, speaking waves. */
export const VoiceOrb = ({ state, size = "md", className }: { state: VoiceState; size?: "sm" | "md" | "lg"; className?: string }) => {
  const px = size === "sm" ? "size-7" : size === "lg" ? "size-16" : "size-12";
  const off = state === "off";
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", px, className)} aria-hidden>
      <LiveCoachStyles />
      {/* Outer halo */}
      {state === "listening" && <span className="pc-breathe absolute inset-0 rounded-full bg-primary/70" />}
      {state === "speaking" && (
        <>
          <span className="pc-ripple absolute inset-0 rounded-full border-2 border-primary/70" />
          <span className="pc-ripple absolute inset-0 rounded-full border-2 border-emerald-300/60" style={{ animationDelay: "0.8s" }} />
        </>
      )}
      {state === "thinking" && (
        <span className="pc-spin absolute -inset-1 rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,var(--primary)_120deg,#a5f3fc_200deg,transparent_300deg)] opacity-90" />
      )}
      {/* Core */}
      <span className={cn(
        "relative flex size-full items-center justify-center overflow-hidden rounded-full ring-1 transition-[background,opacity,box-shadow] duration-500",
        off ? "bg-white/10 opacity-60 ring-white/15"
          : "bg-[radial-gradient(circle_at_30%_25%,#ccfbf1_0%,var(--primary)_45%,#134e4a_100%)] ring-white/30 shadow-[0_0_24px_-2px_color-mix(in_oklch,var(--primary)_75%,transparent)]",
        state === "listening" && "pc-core",
      )}>
        {state === "thinking" && (
          <span className="pc-shimmer absolute inset-0 bg-[linear-gradient(110deg,transparent_30%,rgba(255,255,255,.55)_50%,transparent_70%)]" />
        )}
        {state === "speaking" ? (
          <span className="relative flex h-1/2 w-full items-center gap-[12%] px-[18%]">
            {BARS.map((b, i) => (
              <span key={i} className="pc-bar w-full rounded-full bg-white/95"
                style={{ height: b.h, animationDuration: b.d, animationDelay: b.delay }} />
            ))}
          </span>
        ) : (
          <SparklesIcon className={cn("relative", size === "sm" ? "size-3.5" : size === "lg" ? "size-7" : "size-5",
            off ? "text-white/60" : "text-white drop-shadow")} />
        )}
      </span>
    </span>
  );
};

/** "Live AI coach" pill. Render only when the feed says the realtime coach is up. */
export const LiveCoachBadge = ({ voice, compact, className }: { voice?: VoiceState; compact?: boolean; className?: string }) => (
  <span
    title={S.liveCoach.en}
    className={cn(
      "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[linear-gradient(135deg,color-mix(in_oklch,var(--primary)_35%,transparent),rgba(139,92,246,.28))]",
      "px-2.5 py-1 text-xs font-semibold text-white ring-1 ring-white/20 shadow-[0_0_18px_-6px_var(--primary)] animate-in fade-in zoom-in-90",
      className,
    )}
  >
    <LiveCoachStyles />
    <SparklesIcon className="size-3.5 text-teal-200" aria-hidden />
    {compact ? (
      <>
        <span className="sm:hidden">{S.liveCoachShort.en}</span>
        <span className="hidden sm:inline">{S.liveCoach.en}</span>
      </>
    ) : (
      <span>{S.liveCoach.en}</span>
    )}
    {voice && voice !== "off" && (
      <span className="relative flex size-2" aria-hidden>
        {voice === "speaking" && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-300 opacity-75" />}
        <span className={cn("relative inline-flex size-2 rounded-full",
          voice === "speaking" ? "bg-emerald-300" : voice === "thinking" ? "bg-violet-300" : "bg-teal-200")} />
      </span>
    )}
  </span>
);

/** Orb plus a bilingual, aria-live status line. In countdown/set the line says the coach is quiet. */
export const VoiceStatus = ({ voice, quiet, showEnglish = true, className }: {
  voice: VoiceState; quiet: boolean; showEnglish?: boolean; className?: string;
}) => {
  const label = quiet ? S.coachQuiet : VOICE_LABEL[voice];
  return (
    <div className={cn("flex items-center justify-center gap-3", className)}>
      <VoiceOrb state={quiet && voice !== "speaking" ? "off" : voice} />
      <p role="status" aria-live="polite"
        className={cn("min-w-0 max-w-[16rem] rounded-2xl px-3 py-1.5 text-left leading-tight ring-1 backdrop-blur-md sm:max-w-sm",
          quiet ? "bg-neutral-900/80 ring-white/15" : "bg-white/10 ring-white/15")}>
        <span lang="ml" className="font-ml block text-sm text-white">{label.ml}</span>
        {showEnglish && <span className="block text-xs text-white/70">{label.en}</span>}
      </p>
    </div>
  );
};

/** Tap-to-unmute hint shown when the patient's mic is off while the live coach is listening. */
export const MicOffHint = ({ onEnable, className }: { onEnable: () => void; className?: string }) => (
  <button type="button" onClick={onEnable}
    className={cn(
      "pointer-events-auto mx-auto flex min-h-11 max-w-full items-center gap-2 rounded-full bg-amber-400 px-4 py-1.5 text-left text-neutral-950 shadow-lg",
      "outline-none ring-1 ring-amber-200/60 transition-transform active:scale-[0.98] focus-visible:ring-[3px] focus-visible:ring-white animate-in fade-in slide-in-from-bottom-1",
      className,
    )}>
    <MicOffIcon className="size-4 shrink-0" aria-hidden />
    <span className="flex min-w-0 flex-col leading-tight">
      <span lang="ml" className="font-ml text-sm font-semibold">{S.micOffHint.ml}</span>
      <span className="text-xs">{S.micOffHint.en}</span>
    </span>
  </button>
);

const TextWithLang = ({ item, className }: { item: TranscriptItem; className?: string }) =>
  isMalayalam(item)
    ? <span lang="ml" className={cn("font-ml", className)}>{item.text}</span>
    : <span lang={item.lang === "en" ? "en" : undefined} className={className}>{item.text}</span>;

/** Keeps a scroll container pinned to the newest item unless the viewer has scrolled up to read. */
function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [dep]);
  const onScroll = () => {
    const el = ref.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };
  return { ref, onScroll };
}

/**
 * Patient chat bubbles: patient on the right, coach on the left. Partials are italic and faded with typing
 * dots. `overlay` floats over the video (newest pinned to the bottom, older ones fade out at the top);
 * `card` scrolls inside the desktop Conversation card.
 */
export const TranscriptBubbles = ({ items, voice, variant = "overlay", limit = 6, className }: {
  items: TranscriptItem[]; voice: VoiceState; variant?: "overlay" | "card"; limit?: number; className?: string;
}) => {
  const recent = items.slice(-limit);
  const last = recent[recent.length - 1];
  const showThinking = voice === "thinking" && !(last && last.role === "coach" && !last.final);
  const { ref, onScroll } = useStickToBottom(`${items.length}:${last?.text.length ?? 0}:${showThinking}`);
  if (recent.length === 0 && !showThinking) return null;
  const overlay = variant === "overlay";
  return (
    <div ref={ref} onScroll={onScroll}
      className={cn(
        "flex flex-col gap-2",
        overlay
          ? "justify-end overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_28%)]"
          : "overflow-y-auto overscroll-contain pr-1",
        className,
      )}>
      {recent.map((t) => {
        const mine = t.role === "user";
        return (
          <div key={`${t.role}:${t.turnId}`}
            className={cn("flex max-w-[85%] items-end gap-1.5 animate-in fade-in slide-in-from-bottom-2 duration-300",
              mine ? "flex-row-reverse self-end" : "self-start")}>
            {!mine && (
              <span className="mb-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/90 ring-1 ring-white/25" aria-hidden>
                <SparklesIcon className="size-3.5 text-white" />
              </span>
            )}
            <p className={cn(
              "min-w-0 rounded-2xl px-3 py-2 leading-snug shadow-md [overflow-wrap:anywhere]",
              overlay ? "text-[0.95rem]" : "text-sm",
              mine ? "rounded-br-md bg-primary text-white" : "rounded-bl-md bg-white/12 text-white ring-1 ring-white/15 backdrop-blur-md",
              !t.final && "italic opacity-75",
            )}>
              <span className="sr-only">{mine ? S.you.en : S.coach.en}: </span>
              <TextWithLang item={t} />
              {!t.final && <TypingDots className="ml-1.5 text-white/80" />}
            </p>
          </div>
        );
      })}
      {showThinking && (
        <div className="flex items-end gap-1.5 self-start animate-in fade-in">
          <span className="mb-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/90 ring-1 ring-white/25" aria-hidden>
            <SparklesIcon className="size-3.5 text-white" />
          </span>
          <span className="rounded-2xl rounded-bl-md bg-white/12 px-3 py-2.5 text-white/85 ring-1 ring-white/15 backdrop-blur-md">
            <TypingDots />
            <span className="sr-only">{S.voiceThinking.en}</span>
          </span>
        </div>
      )}
    </div>
  );
};

/** Patient desktop: the conversation as a card beside the video. Bubbles dim while the coach is quiet. */
export const ConversationCard = ({ items, voice, quiet, className }: {
  items: TranscriptItem[]; voice: VoiceState; quiet: boolean; className?: string;
}) => (
  <section aria-labelledby="conversation-title"
    className={cn("flex min-h-0 flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-4 text-white", className)}>
    <div className="flex items-center justify-between gap-2">
      <h3 id="conversation-title" className="flex items-center gap-2 font-semibold">
        <VoiceOrb state={quiet && voice !== "speaking" ? "off" : voice} size="sm" />
        <span><span lang="ml" className="font-ml">{S.conversation.ml}</span> <span className="font-normal text-white/60">· {S.conversation.en}</span></span>
      </h3>
      <LiveCoachBadge />
    </div>
    {quiet && (
      <p className="rounded-lg bg-neutral-900/80 px-3 py-2 text-xs ring-1 ring-white/10">
        <span lang="ml" className="font-ml block text-sm">{S.coachQuiet.ml}</span>
        <span className="text-white/70">{S.coachQuiet.en}</span>
      </p>
    )}
    {items.length === 0 && voice !== "thinking" ? (
      <p className="rounded-lg border border-dashed border-white/15 p-3 text-center text-sm text-white/60">
        <span lang="ml" className="font-ml block">{S.conversationEmpty.ml}</span>
        <span className="text-xs">{S.conversationEmpty.en}</span>
      </p>
    ) : (
      <TranscriptBubbles items={items} voice={voice} variant="card" limit={20}
        className={cn("max-h-[38dvh] min-h-24 transition-opacity", quiet && "opacity-40")} />
    )}
  </section>
);

/** Physio side: the full conversation with role labels, scrollable, sticking to the newest line. */
export const TranscriptPanel = ({ items, voice, live, className }: {
  items: TranscriptItem[]; voice: VoiceState; live: boolean; className?: string;
}) => {
  const last = items[items.length - 1];
  const { ref, onScroll } = useStickToBottom(`${items.length}:${last?.text.length ?? 0}`);
  return (
    <section aria-label="Live coach conversation" className={cn("flex min-h-0 flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-white/60">
          <VoiceOrb state={live ? voice : "off"} size="sm" />
          Conversation
        </h3>
        {live ? <LiveCoachBadge voice={voice} /> : (
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/60">Live coach offline · recorded cues continue</span>
        )}
      </div>
      <div ref={ref} onScroll={onScroll} aria-live="polite"
        className="flex max-h-80 min-h-16 flex-col gap-2.5 overflow-y-auto overscroll-contain pr-1 md:max-h-[34dvh]">
        {items.length === 0 && (
          <p className="text-sm text-white/50">The patient&apos;s questions and the AI coach&apos;s replies appear here.</p>
        )}
        {items.map((t) => {
          const coach = t.role === "coach";
          return (
            <div key={`${t.role}:${t.turnId}`} className={cn("flex gap-2.5 animate-in fade-in", !t.final && "opacity-70")}>
              <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ring-1",
                coach ? "bg-primary/90 ring-white/25" : "bg-white/10 ring-white/15")} aria-hidden>
                {coach ? <SparklesIcon className="size-3.5 text-white" /> : <UserIcon className="size-3.5 text-white/80" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn("text-[11px] font-semibold uppercase tracking-wider", coach ? "text-teal-300" : "text-white/60")}>
                  {coach ? "AI coach" : "Patient"}{!t.final && <span className="ml-1.5 font-normal normal-case tracking-normal text-white/50">typing…</span>}
                </p>
                <p className={cn("leading-relaxed text-white [overflow-wrap:anywhere]", !t.final && "italic")}>
                  <TextWithLang item={t} />
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
