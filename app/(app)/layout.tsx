import { AppShell } from "@/components/layout/AppShell";
import { GlobalJobProgress } from "@/components/GlobalJobProgress";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      {children}
      <GlobalJobProgress />
    </AppShell>
  );
}
