import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ToastProvider } from "@/components/ui/toast";
import { SignupConversion } from "@/components/analytics/signup-conversion";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardLayout>
      <SignupConversion />
      <ToastProvider>{children}</ToastProvider>
    </DashboardLayout>
  );
}
