import Image from "next/image";

import { AuthBrandPanel } from "@/modules/auth/ui/components/auth-brand-panel";

interface Props {
  children: React.ReactNode;
};

const Layout = ({ children }: Props) => {
  return (
    <div className="grid min-h-svh bg-background lg:grid-cols-2">
      <main className="relative flex flex-col bg-brand-grid px-4 py-8 sm:px-6 md:px-10">
        <div className="flex items-center gap-2.5 lg:hidden">
          <Image src="/logo.svg" alt="" width={32} height={32} priority />
          <span className="text-base font-semibold tracking-tight">PhysioCoach</span>
        </div>
        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-sm">
            {children}
          </div>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Patients: please use the link your physiotherapist sent you.
        </p>
      </main>
      <AuthBrandPanel />
    </div>
  );
};

export default Layout;
