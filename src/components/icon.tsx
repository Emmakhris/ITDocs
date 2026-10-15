import {
  AppWindow,
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  Boxes,
  GitPullRequest,
  Handshake,
  KeyRound,
  LayoutDashboard,
  MapPin,
  Network,
  Route,
  ScanLine,
  Settings,
  Share2,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  "app-window": AppWindow,
  "arrow-left-right": ArrowLeftRight,
  "bar-chart-3": BarChart3,
  "book-open": BookOpen,
  boxes: Boxes,
  "git-pull-request": GitPullRequest,
  handshake: Handshake,
  "key-round": KeyRound,
  "layout-dashboard": LayoutDashboard,
  "map-pin": MapPin,
  network: Network,
  route: Route,
  "scan-line": ScanLine,
  settings: Settings,
  "share-2": Share2,
  "shield-check": ShieldCheck,
  users: Users,
};

export function Icon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  const C = ICONS[name] ?? Boxes;
  return <C className={className} aria-hidden />;
}
