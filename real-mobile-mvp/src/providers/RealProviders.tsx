import { AuthProvider } from "../auth/AuthProvider";
import { QueueProvider } from "../queue/QueueProvider";

export function RealProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <QueueProvider>{children}</QueueProvider>
    </AuthProvider>
  );
}

