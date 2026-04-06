import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export function ProtectedRoute() {
  const { status } = useAuth();

  if (status === 'checking' || status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-dark-900">
        <div className="text-gray-400 text-lg">Loading...</div>
      </div>
    );
  }

  if (status === 'unauthenticated' || status === 'error') {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
