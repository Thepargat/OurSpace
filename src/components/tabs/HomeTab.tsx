import DashboardHome from "../dashboard/DashboardHome";
import PageTransition from "../ui/PageTransition";

interface HomeTabProps {
  isAnniversary?: boolean;
  onNavigate?: (tab: string) => void;
}

export default function HomeTab({ isAnniversary = false, onNavigate }: HomeTabProps) {
  return (
    <PageTransition>
      <DashboardHome />
    </PageTransition>
  );
}
