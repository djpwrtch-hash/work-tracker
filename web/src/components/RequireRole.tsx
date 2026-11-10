import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

type AccessLevel = 'director' | 'hr' | 'employee';

export default function RequireRole({ roles, children }: { roles: AccessLevel[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!roles.includes(user.accessLevel)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
