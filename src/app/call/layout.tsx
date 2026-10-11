interface Props {
  children: React.ReactNode;
}

const Layout = ({ children }: Props) => <div className="h-dvh overflow-x-hidden bg-neutral-950 text-white">{children}</div>;

export default Layout;
