import { Navigate, Route, Routes } from "react-router-dom";
import { BottomNav } from "./components/layout/BottomNav.js";
import { Header } from "./components/layout/Header.js";
import { LoginPage } from "./components/layout/LoginPage.js";
import { InventoryPage } from "./components/inventory/InventoryPage.js";
import { GearPage } from "./components/gear/GearPage.js";
import { RollsPage } from "./components/rolls/RollsPage.js";
import { useAuth } from "./hooks/useAuth.js";

export function App() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return null;

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <div className="dark flex min-h-dvh flex-col bg-background text-foreground">
      <Header />
      <main className="flex-1 px-4 pt-4 pb-20">
        <Routes>
          <Route path="/" element={<Navigate to="/inventory" replace />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/rolls" element={<RollsPage />} />
          <Route path="/gear" element={<GearPage />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  );
}
