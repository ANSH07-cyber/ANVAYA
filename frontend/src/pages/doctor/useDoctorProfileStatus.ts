import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../app/AuthContext";
import { doctorService } from "../../services/doctorService";
import type { DoctorProfileMeResponse, DoctorVerificationStatus } from "../../types/doctor";

export interface DoctorProfileStatusResult {
  profile: DoctorProfileMeResponse | null;
  verificationStatus: DoctorVerificationStatus | "suspended" | null;
  isApproved: boolean;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useDoctorProfileStatus(): DoctorProfileStatusResult {
  const { user } = useAuth();
  const [profile, setProfile] = useState<DoctorProfileMeResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await doctorService.getDoctorProfile();
      setProfile(data);
    } catch (err: unknown) {
      const detail =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : null;
      setError(detail || "Unable to retrieve doctor profile status.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  const isInactiveOrSuspended = Boolean(user && !user.is_active);
  const verificationStatus: DoctorVerificationStatus | "suspended" | null =
    isInactiveOrSuspended
      ? "suspended"
      : profile
        ? profile.verification_status
        : null;

  const isApproved = Boolean(
    user?.is_active && profile?.verification_status === "approved"
  );

  return {
    profile,
    verificationStatus,
    isApproved,
    isLoading,
    error,
    refetch: fetchProfile,
  };
}
