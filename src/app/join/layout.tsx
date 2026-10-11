import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PhysioCoach session",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

interface Props {
  children: React.ReactNode;
}

const Layout = ({ children }: Props) => <div className="h-dvh overflow-x-hidden bg-neutral-950 text-white">{children}</div>;

export default Layout;
