import { LogOut, MoreVertical } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useAuth } from "../../hooks/useAuth.js";

export function Header() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <header className="flex items-center justify-between border-b border-border bg-card px-4 py-2.5">
      <h1 className="text-base font-semibold">Tomu</h1>
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          aria-label="Menu"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 w-48 rounded-md border border-border bg-popover py-1 shadow-lg">
            <div className="px-3 py-1.5 text-xs text-muted-foreground">{user?.email}</div>
            <div className="mx-2 my-1 border-t border-border" />
            <button
              onClick={logout}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
              Log out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
