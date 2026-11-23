import { Navigate, useLocation } from "react-router-dom";
import { AlertCircle, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { useAuth } from "./AuthContext";
import { getRoleHomePath } from "../utils/roleUtils";
import type { UserRole } from "../types/auth";

type ProtectedRouteProps = {
  children: ReactNode;
  allowedRoles?: UserRole[];
};

export default function ProtectedRoute({
  children,
  allowedRoles,
}: ProtectedRouteProps) {
  const { user, isLoading, connectionError, retryConnection } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="auth-loading">
        <div className="auth-loading-spinner" />
        <span>Securing your Anvaya workspace...</span>
      </div>
    );
  }

  // Recoverable connection error screen: preserves credentials without rendering protected clinical data
  if (connectionError) {
    return (
      <div className="auth-connection-banner" role="alert">
        <div className="auth-connection-card">
          <div className="auth-connection-icon">
            <AlertCircle size={24} />
          </div>
          <h2 className="auth-connection-title">Connection Disrupted</h2>
          <p className="auth-connection-msg">{connectionError}</p>
          <button
            type="button"
            className="auth-retry-button"
            onClick={() => void retryConnection()}
          >
            <RefreshCw size={16} style={{ marginRight: "8px" }} />
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location }}
      />
    );
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={getRoleHomePath(user.role)} replace />;
  }

  return children;
}
