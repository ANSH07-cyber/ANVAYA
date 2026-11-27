import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import PatientDashboard from "./pages/patient/PatientDashboard";
import ProfileSetupPage from "./pages/patient/ProfileSetupPage";
import LoginPage from "./pages/auth/LoginPage";
import RegisterPage from "./pages/auth/RegisterPage";
import ProtectedRoute from "./app/ProtectedRoute";
import AppointmentsPage from "./pages/patient/AppointmentsPage";
import HealthRecordsPage from "./pages/patient/HealthRecordsPage";
import PrescriptionsPage from "./pages/patient/PrescriptionsPage";
import FindDoctorsPage from "./pages/patient/FindDoctorsPage";
import ConsentPage from "./pages/patient/ConsentPage";
import DoctorDashboardPage from "./pages/doctor/DoctorDashboardPage";
import DoctorAvailabilityPage from "./pages/doctor/DoctorAvailabilityPage";
import DoctorAppointmentsPage from "./pages/doctor/DoctorAppointmentsPage";
import DoctorConsultationPage from "./pages/doctor/DoctorConsultationPage";
import DoctorPrescriptionsPage from "./pages/doctor/DoctorPrescriptionsPage";
import DoctorProfilePage from "./pages/doctor/DoctorProfilePage";
import DoctorPatientsPage from "./pages/doctor/DoctorPatientsPage";
import AdminDashboardPage from "./pages/admin/AdminDashboardPage";
import UserManagementPage from "./pages/admin/UserManagementPage";
import DoctorManagementPage from "./pages/admin/DoctorManagementPage";
import PatientManagementPage from "./pages/admin/PatientManagementPage";
import AppointmentOversightPage from "./pages/admin/AppointmentOversightPage";
import AuditLogsPage from "./pages/admin/AuditLogsPage";
import AdminSettingsPage from "./pages/admin/AdminSettingsPage";
import SkinLesionScreeningPage from "./pages/patient/SkinLesionScreeningPage";
import InternalAudioReviewPage from "./pages/dev/InternalAudioReviewPage";
import SkinHealthDevPreviewPage from "./pages/dev/SkinHealthDevPreviewPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />

        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        <Route
          path="/patient"
          element={
            <ProtectedRoute allowedRoles={["patient"]}>
              <PatientDashboard />
            </ProtectedRoute>
          }
        />

                <Route
          path="/patient/profile-setup"
          element={
            <ProtectedRoute allowedRoles={["patient"]}>
              <ProfileSetupPage />
            </ProtectedRoute>
          }
        />
<Route
  path="/patient/appointments"
  element={
    <ProtectedRoute allowedRoles={["patient"]}>
      <AppointmentsPage />
    </ProtectedRoute>
  }
/>

       <Route
  path="/patient/doctors"
  element={
    <ProtectedRoute allowedRoles={["patient"]}>
      <FindDoctorsPage />
    </ProtectedRoute>
  }
/>

        <Route
  path="/patient/records"
  element={
    <ProtectedRoute allowedRoles={["patient"]}>
      <HealthRecordsPage />
    </ProtectedRoute>
  }
/>

        <Route
  path="/patient/prescriptions"
  element={
    <ProtectedRoute allowedRoles={["patient"]}>
      <PrescriptionsPage />
    </ProtectedRoute>
  }
/>

        <Route
          path="/patient/skin-health"
          element={
            <ProtectedRoute allowedRoles={["patient"]}>
              <SkinLesionScreeningPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/patient/consent"
          element={
            <ProtectedRoute allowedRoles={["patient"]}>
              <ConsentPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/doctor"
          element={
            <ProtectedRoute allowedRoles={["doctor"]}>
              <DoctorDashboardPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/doctor/appointments"
          element={
            <ProtectedRoute allowedRoles={["doctor"]}>
              <DoctorAppointmentsPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/doctor/availability"
          element={
            <ProtectedRoute allowedRoles={["doctor"]}>
              <DoctorAvailabilityPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/doctor/consultation/:appointmentId"
          element={
            <ProtectedRoute allowedRoles={["doctor"]}>
              <DoctorConsultationPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/doctor/patients"
          element={
            <ProtectedRoute allowedRoles={["doctor"]}>
              <DoctorPatientsPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/doctor/prescriptions"
          element={
            <ProtectedRoute allowedRoles={["doctor"]}>
              <DoctorPrescriptionsPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/doctor/profile"
          element={
            <ProtectedRoute allowedRoles={["doctor"]}>
              <DoctorProfilePage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <AdminDashboardPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin/users"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <UserManagementPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin/doctors"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <DoctorManagementPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin/patients"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <PatientManagementPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin/appointments"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <AppointmentOversightPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin/audit-logs"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <AuditLogsPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin/settings"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <AdminSettingsPage />
            </ProtectedRoute>
          }
        />

        {import.meta.env.DEV && (
          <>
            <Route path="/dev/audio-review" element={<InternalAudioReviewPage />} />
            <Route path="/dev/skin-health-preview" element={<SkinHealthDevPreviewPage />} />
          </>
        )}

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;