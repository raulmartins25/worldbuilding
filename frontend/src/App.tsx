import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { Worlds } from "./pages/Worlds";
import { WorldShell } from "./pages/WorldShell";
import type { ReactNode } from "react";

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-screen muted">Carregando…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/worlds" element={<Protected><Worlds /></Protected>} />
      <Route path="/worlds/:pid/*" element={<Protected><WorldShell /></Protected>} />
      <Route path="*" element={<Navigate to="/worlds" replace />} />
    </Routes>
  );
}
