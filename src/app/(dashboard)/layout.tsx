import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ToastProvider } from "@/components/ui/toast";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardLayout>
      <ToastProvider>{children}</ToastProvider>
    </DashboardLayout>
  );
}
