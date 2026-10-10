interface Props {
  children: React.ReactNode;
}

const Layout = ({ children }: Props) => <div className="h-dvh bg-black">{children}</div>;

export default Layout;
