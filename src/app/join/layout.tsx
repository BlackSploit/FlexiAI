import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PhysioCoach session",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

interface Props {
  children: React.ReactNode;
}

const Layout = ({ children }: Props) => <div className="h-dvh bg-black">{children}</div>;

export default Layout;
