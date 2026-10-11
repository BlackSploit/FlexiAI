"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PanelLeftCloseIcon, PanelLeftIcon, SearchIcon } from "lucide-react";

import { useTRPC } from "@/trpc/client";
import { LIVE_REFETCH_MS } from "@/constants";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";

import { DashboardCommand } from "./dashboard-command";

const LiveIndicator = () => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.analytics.overview.queryOptions(undefined, {
    refetchInterval: (q) => ((q.state.data?.liveSessions ?? 0) > 0 ? LIVE_REFETCH_MS : 30_000),
  }));
  const live = data?.liveSessions ?? 0;

  if (live === 0) {
    return (
      <span className="hidden sm:inline-flex items-center gap-2 rounded-full border bg-card px-3 h-9 text-xs font-medium text-muted-foreground">
        <span className="size-2 rounded-full bg-muted-foreground/40" aria-hidden />
        No live sessions
      </span>
    );
  }

  return (
    <Link
      href="/sessions?status=live"
      className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 h-9 text-xs font-semibold text-emerald-700 dark:text-emerald-300 transition-colors hover:bg-emerald-500/15 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="relative flex size-2" aria-hidden>
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
      </span>
      {live} live {live === 1 ? "session" : "sessions"}
    </Link>
  );
};

export const DashboardNavbar = () => {
  const { state, toggleSidebar, isMobile } = useSidebar();
  const [commandOpen, setCommandOpen] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const collapsed = state === "collapsed" || isMobile;

  return (
    <>
      <DashboardCommand open={commandOpen} setOpen={setCommandOpen} />
      <nav className="sticky top-0 z-20 flex items-center gap-x-2 border-b bg-background/80 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 md:px-6">
        <Button
          className="size-9"
          variant="outline"
          onClick={toggleSidebar}
          aria-label={collapsed ? "Open sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftIcon className="size-4" /> : <PanelLeftCloseIcon className="size-4" />}
        </Button>
        <Button
          className="h-9 flex-1 max-w-[320px] justify-start gap-2 font-normal text-muted-foreground hover:text-muted-foreground"
          variant="outline"
          size="sm"
          onClick={() => setCommandOpen((open) => !open)}
          aria-label="Search patients and sessions"
        >
          <SearchIcon className="size-4" />
          <span className="truncate">Search patients, sessions…</span>
          <kbd className="ml-auto pointer-events-none hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            <span className="text-xs">&#8984;</span>K
          </kbd>
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <LiveIndicator />
        </div>
      </nav>
    </>
  );
};
