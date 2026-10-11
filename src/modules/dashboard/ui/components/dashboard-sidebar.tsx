"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ClipboardListIcon, LayoutDashboardIcon, ShieldCheckIcon, UsersIcon, VideoIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

import { DashboardUserButton } from "./dashboard-user-button";

const navItems = [
  { icon: LayoutDashboardIcon, label: "Overview", href: "/overview" },
  { icon: UsersIcon, label: "Patients", href: "/patients" },
  { icon: ClipboardListIcon, label: "Prescriptions", href: "/prescriptions" },
  { icon: VideoIcon, label: "Sessions", href: "/sessions" },
];

const isDemo = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

export const DashboardSidebar = () => {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();

  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar>
      <SidebarHeader className="px-4 pt-5 pb-3">
        <Link
          href="/overview"
          onClick={closeOnMobile}
          className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <span className="flex size-9 items-center justify-center rounded-xl bg-white/95 shadow-sm ring-1 ring-black/5">
            <Image src="/logo.svg" height={24} width={24} alt="" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-lg font-semibold tracking-tight text-sidebar-accent-foreground">PhysioCoach</span>
            <span className="mt-1 text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
              Physio workspace
            </span>
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50">Clinic</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {navItems.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.label}
                      className={cn(
                        "relative h-10 rounded-lg px-3 text-sidebar-foreground/80 transition-colors",
                        "hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                        "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:font-semibold",
                      )}
                    >
                      <Link href={item.href} onClick={closeOnMobile} aria-current={active ? "page" : undefined}>
                        {active && (
                          <span aria-hidden className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary" />
                        )}
                        <item.icon className="size-[18px]" />
                        <span className="text-sm tracking-tight">{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-3 p-3 text-sidebar-foreground">
        <div className="rounded-xl border border-sidebar-foreground/10 bg-sidebar-accent/40 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-sidebar-accent-foreground">
            <ShieldCheckIcon className="size-4 text-emerald-400" />
            {isDemo ? "Demo mode" : "Safety first"}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-sidebar-foreground/70">
            {isDemo
              ? "Replay sessions are included in charts and marked “demo”."
              : "Pain, symptom and Stop alerts from live calls appear on your Overview."}
          </p>
        </div>
        <DashboardUserButton />
      </SidebarFooter>
    </Sidebar>
  );
};
