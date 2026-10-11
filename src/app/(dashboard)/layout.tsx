import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { SidebarProvider } from "@/components/ui/sidebar";

import { DashboardNavbar } from "@/modules/dashboard/ui/components/dashboard-navbar";
import { DashboardSidebar } from "@/modules/dashboard/ui/components/dashboard-sidebar";

interface Props {
  children: React.ReactNode;
}

// The single physio guard for every dashboard page.
const Layout = async ({ children }: Props) => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session || session.user.role !== "physio") {
    redirect("/sign-in");
  }

  return (
    <SidebarProvider>
      <DashboardSidebar />
      <main className="flex min-h-svh min-w-0 flex-1 flex-col bg-muted/40">
        <DashboardNavbar />
        {children}
      </main>
    </SidebarProvider>
  );
};

export default Layout;
