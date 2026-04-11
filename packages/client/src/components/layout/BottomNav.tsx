import { Film, Disc, Camera } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "../../lib/utils.js";

const navItems = [
  { path: "/inventory", label: "Film", icon: Film },
  { path: "/rolls", label: "Rolls", icon: Disc },
  { path: "/gear", label: "Gear", icon: Camera },
];

export function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex justify-around border-t border-border bg-card py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
      {navItems.map((item) => {
        const isActive = location.pathname.startsWith(item.path);
        return (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-1 transition-colors",
              isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <item.icon className={cn("h-5 w-5", isActive && "text-primary")} />
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
