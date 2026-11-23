import type { UserRole } from "../types/auth";

export function getRoleHomePath(role: UserRole): string {
  switch (role) {
    case "patient":
      return "/patient";
    case "doctor":
      return "/doctor";
    case "admin":
      return "/admin";
    default:
      return "/login";
  }
}

export function isPathAllowedForRole(pathname: string, role: UserRole): boolean {
  if (!pathname || typeof pathname !== "string") return false;
  const cleanPath = pathname.split("?")[0].split("#")[0];

  switch (role) {
    case "admin":
      return cleanPath === "/admin" || cleanPath.startsWith("/admin/");
    case "doctor":
      return cleanPath === "/doctor" || cleanPath.startsWith("/doctor/");
    case "patient":
      return cleanPath === "/patient" || cleanPath.startsWith("/patient/");
    default:
      return false;
  }
}
