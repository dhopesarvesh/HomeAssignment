import React, { useEffect, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import "./style.css";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001/api/v1";
const api = axios.create({ baseURL: API_BASE });

const getAccessToken = () => localStorage.getItem("accessToken");
const setTokens = (accessToken, refreshToken) => {
  localStorage.setItem("accessToken", accessToken);
  if (refreshToken) sessionStorage.setItem("refreshToken", refreshToken);
};
const clearTokens = () => {
  localStorage.removeItem("accessToken");
  sessionStorage.removeItem("refreshToken");
};

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState(null); // { message, type: 'success'|'error' }

  // Navigation
  const [activeTab, setActiveTab] = useState("directory");

  // Directory & Search
  const [doctors, setDoctors] = useState([]);
  const [specialties, setSpecialties] = useState([]);
  const [filters, setFilters] = useState({ q: "", specialty: "", mode: "ALL", language: "" });

  // Patient / Doctor Core State
  const [appointments, setAppointments] = useState([]);
  const [consultations, setConsultations] = useState([]);
  const [doctorProfile, setDoctorProfile] = useState(null);
  const [doctorSlots, setDoctorSlots] = useState([]);
  const [doctorRules, setDoctorRules] = useState([]);
  const [doctorBlockedPeriods, setDoctorBlockedPeriods] = useState([]);
  const [consentRecords, setConsentRecords] = useState([]);

  // Notifications
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifDrawer, setShowNotifDrawer] = useState(false);

  // Admin State
  const [adminOverview, setAdminOverview] = useState(null);
  const [verificationQueue, setVerificationQueue] = useState([]);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminAppointments, setAdminAppointments] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);

  // Modals
  const [bookingModal, setBookingModal] = useState(null); // { doctor, slots, slotId, mode, reasonForVisit }
  const [rescheduleModal, setRescheduleModal] = useState(null); // { appointment, slots, slotId, reason }
  const [cancelModal, setCancelModal] = useState(null); // { appointment, reason }
  const [historyModal, setHistoryModal] = useState(null); // { appointment }
  const [prescriptionModal, setPrescriptionModal] = useState(null); // { consultationId, isAmendment, prescriptionId, items, reason }

  // Forms
  const [authForm, setAuthForm] = useState({ email: "", password: "", name: "", phone: "", gender: "Other" });
  const [registering, setRegistering] = useState(false);
  const [slotForm, setSlotForm] = useState({ startsAt: "", endsAt: "" });
  const [ruleForm, setRuleForm] = useState({ dayOfWeek: 1, startTime: "09:30", endTime: "16:30", slotDurationMinutes: 30 });
  const [blockForm, setBlockForm] = useState({ startsAt: "", endsAt: "", reasonCategory: "PERSONAL_LEAVE" });
  const [credentialForm, setCredentialForm] = useState({ credentialType: "MEDICAL_LICENSE", issuingAuthority: "", credentialReference: "" });

  const notify = (message, type = "success") => {
    setNotice({ message, type });
    setTimeout(() => setNotice(null), 6000);
  };

  // Authenticated HTTP helper
  const request = useCallback(async (url, options = {}) => {
    const token = getAccessToken();
    const headers = {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    try {
      const response = await api.request({ url, ...options, headers });
      return response.data;
    } catch (err) {
      if (err.response?.status === 401 && token) {
        // Try token refresh
        const refreshToken = sessionStorage.getItem("refreshToken");
        if (refreshToken) {
          try {
            const refreshRes = await api.post("/auth/refresh", { refreshToken });
            setTokens(refreshRes.data.accessToken, refreshRes.data.refreshToken);
            headers.Authorization = `Bearer ${refreshRes.data.accessToken}`;
            const retryRes = await api.request({ url, ...options, headers });
            return retryRes.data;
          } catch {
            clearTokens();
            setUser(null);
          }
        } else {
          clearTokens();
          setUser(null);
        }
      }
      throw err;
    }
  }, []);

  // Fetch Public Directory
  const loadDirectory = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filters.q) params.set("q", filters.q);
      if (filters.specialty) params.set("specialty", filters.specialty);
      if (filters.mode && filters.mode !== "ALL") params.set("mode", filters.mode);
      if (filters.language) params.set("language", filters.language);

      const res = await request(`/doctors?${params.toString()}`);
      setDoctors(res.data || []);
    } catch (err) {
      console.error("Directory load failed:", err);
    }
  }, [filters, request]);

  // Fetch Specialties
  const loadSpecialties = useCallback(async () => {
    try {
      const res = await request("/specialties");
      setSpecialties(res.data || []);
    } catch (err) {
      console.error("Specialties load failed:", err);
    }
  }, [request]);

  // Fetch Notifications
  const loadNotifications = useCallback(async () => {
    if (!getAccessToken()) return;
    try {
      const res = await request("/notifications?limit=15");
      setNotifications(res.data || []);
      setUnreadCount(res.unreadCount || 0);
    } catch (err) {
      console.error("Notifications load error:", err);
    }
  }, [request]);

  // Load User Data based on Role
  const loadUserData = useCallback(async (account) => {
    if (!account) return;
    setLoading(true);
    try {
      loadNotifications();

      if (account.role === "PATIENT") {
        const [appts, consults, consents] = await Promise.all([
          request("/appointments"),
          request("/consultations"),
          request("/consent"),
        ]);
        setAppointments(appts.data || []);
        setConsultations(consults.data || []);
        setConsentRecords(consents.data || []);
      } else if (account.role === "DOCTOR") {
        const [appts, consults, docProfileRes] = await Promise.all([
          request("/appointments"),
          request("/consultations"),
          request("/doctors/me"),
        ]);
        setAppointments(appts.data || []);
        setConsultations(consults.data || []);
        const profile = docProfileRes.data;
        setDoctorProfile(profile);

        if (profile?.id) {
          const slotsRes = await request(`/doctors/${profile.id}/slots`);
          setDoctorSlots(slotsRes.data || []);
          setDoctorRules(profile.availabilityRules || []);
          setDoctorBlockedPeriods(profile.blockedPeriods || []);
        }
      } else if (account.role === "ADMIN") {
        const [overview, queue, users, adminAppts, logs] = await Promise.all([
          request("/admin/analytics/overview"),
          request("/admin/verification-queue"),
          request("/admin/users?limit=25"),
          request("/admin/appointments?limit=25"),
          request("/admin/audit-logs?limit=25"),
        ]);
        setAdminOverview(overview.data);
        setVerificationQueue(queue.data || []);
        setAdminUsers(users.data || []);
        setAdminAppointments(adminAppts.data || []);
        setAuditLogs(logs.data || []);
      }
    } catch (err) {
      console.error("User data load error:", err);
      notify(err.response?.data?.error || "Failed to load account records", "error");
    } finally {
      setLoading(false);
    }
  }, [request, loadNotifications]);

  // Initial Load & Auth Check
  useEffect(() => {
    loadSpecialties();
    loadDirectory();

    const token = getAccessToken();
    if (token) {
      request("/users/me")
        .then((res) => {
          setUser(res.user);
          loadUserData(res.user);
          // Set default tab based on role
          if (res.user.role === "DOCTOR") setActiveTab("workspace");
          else if (res.user.role === "ADMIN") setActiveTab("analytics");
        })
        .catch(() => {
          clearTokens();
          setUser(null);
        });
    }
  }, [loadDirectory, loadSpecialties, request, loadUserData]);

  // Re-fetch directory on filters change
  useEffect(() => {
    loadDirectory();
  }, [filters, loadDirectory]);

  // Quick Demo Login Handler
  const handleQuickLogin = async (email, password) => {
    setLoading(true);
    try {
      const res = await request("/auth/login", {
        method: "POST",
        data: { email, password },
      });
      setTokens(res.accessToken, res.refreshToken);
      setUser(res.user);
      notify(`Logged in as ${res.user.name} (${res.user.role})`);
      if (res.user.role === "DOCTOR") setActiveTab("workspace");
      else if (res.user.role === "ADMIN") setActiveTab("analytics");
      else setActiveTab("appointments");
      await loadUserData(res.user);
    } catch (err) {
      notify(err.response?.data?.error || "Login failed", "error");
    } finally {
      setLoading(false);
    }
  };

  // Form Submit Auth (Login / Register)
  const submitAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const endpoint = registering ? "/auth/register" : "/auth/login";
      const payload = registering
        ? authForm
        : { email: authForm.email, password: authForm.password };

      const res = await request(endpoint, { method: "POST", data: payload });
      setTokens(res.accessToken, res.refreshToken);
      setUser(res.user);
      notify(registering ? "Account created successfully!" : `Welcome back, ${res.user.name}!`);
      if (res.user.role === "DOCTOR") setActiveTab("workspace");
      else if (res.user.role === "ADMIN") setActiveTab("analytics");
      else setActiveTab("directory");
      await loadUserData(res.user);
    } catch (err) {
      notify(err.response?.data?.error || "Authentication failed", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    const refreshToken = sessionStorage.getItem("refreshToken");
    if (refreshToken) {
      try {
        await request("/auth/logout", { method: "POST", data: { refreshToken } });
      } catch (e) {
        console.warn("Logout token revocation failed", e);
      }
    }
    clearTokens();
    setUser(null);
    setActiveTab("directory");
    notify("Signed out successfully.");
  };

  // =========================================================================
  // Booking Workflow
  // =========================================================================
  const openBookingModal = async (doctor) => {
    if (!user) {
      notify("Please sign in or use a demo account to book an appointment.", "error");
      return;
    }
    if (user.role !== "PATIENT") {
      notify("Only patients can book consultations.", "error");
      return;
    }
    setLoading(true);
    try {
      const { data: slots } = await request(`/doctors/${doctor.id}/slots`);
      if (!slots || slots.length === 0) {
        notify("No available appointment slots found for this doctor.", "error");
        return;
      }
      setBookingModal({
        doctor,
        slots,
        slotId: slots[0].id,
        mode: "ONLINE",
        reasonForVisit: "General Ayurvedic consultation",
      });
    } catch (err) {
      notify(err.response?.data?.error || "Could not retrieve doctor availability", "error");
    } finally {
      setLoading(false);
    }
  };

  const confirmBooking = async () => {
    if (!bookingModal || !bookingModal.slotId) return;
    setLoading(true);
    try {
      const idempotencyKey = crypto.randomUUID();
      await request("/appointments", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        data: {
          slotId: bookingModal.slotId,
          mode: bookingModal.mode,
          reasonForVisit: bookingModal.reasonForVisit,
        },
      });
      notify("Appointment booked successfully! Check 'My Appointments'.");
      setBookingModal(null);
      await loadUserData(user);
    } catch (err) {
      notify(err.response?.data?.error || "Booking failed", "error");
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // Cancellation Workflow
  // =========================================================================
  const openCancelModal = (appointment) => {
    setCancelModal({ appointment, reason: "Patient scheduling conflict" });
  };

  const confirmCancel = async () => {
    if (!cancelModal) return;
    setLoading(true);
    try {
      await request(`/appointments/${cancelModal.appointment.id}/cancel`, {
        method: "POST",
        data: { reason: cancelModal.reason },
      });
      notify("Appointment successfully cancelled.");
      setCancelModal(null);
      await loadUserData(user);
    } catch (err) {
      notify(err.response?.data?.error || "Cancellation failed", "error");
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // Rescheduling Workflow
  // =========================================================================
  const openRescheduleModal = async (appointment) => {
    setLoading(true);
    try {
      // Find doctor profile ID
      const doctorId = appointment.doctor?.id;
      // Get future available slots for this doctor
      const doc = doctors.find((d) => d.user?.id === doctorId);
      const docProfileId = doc?.id;

      if (!docProfileId) {
        notify("Unable to find doctor availability profile.", "error");
        return;
      }

      const { data: slots } = await request(`/doctors/${docProfileId}/slots`);
      const eligibleSlots = slots.filter((s) => s.id !== appointment.slotId);

      if (eligibleSlots.length === 0) {
        notify("No alternative future slots available for this doctor.", "error");
        return;
      }

      setRescheduleModal({
        appointment,
        slots: eligibleSlots,
        slotId: eligibleSlots[0].id,
        reason: "Patient requested reschedule",
      });
    } catch (err) {
      notify(err.response?.data?.error || "Could not fetch slots for rescheduling", "error");
    } finally {
      setLoading(false);
    }
  };

  const confirmReschedule = async () => {
    if (!rescheduleModal || !rescheduleModal.slotId) return;
    setLoading(true);
    try {
      await request(`/appointments/${rescheduleModal.appointment.id}/reschedule`, {
        method: "POST",
        data: {
          newSlotId: rescheduleModal.slotId,
          reason: rescheduleModal.reason,
        },
      });
      notify("Appointment rescheduled successfully!");
      setRescheduleModal(null);
      await loadUserData(user);
    } catch (err) {
      notify(err.response?.data?.error || "Rescheduling failed", "error");
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // Clinical Consultation Workflows
  // =========================================================================
  const updateConsultationStatus = async (consultationId, action) => {
    setLoading(true);
    try {
      await request(`/consultations/${consultationId}/${action}`, { method: "POST", data: {} });
      notify(`Consultation ${action === "start" ? "started" : "completed"}!`);
      await loadUserData(user);
    } catch (err) {
      notify(err.response?.data?.error || `Could not ${action} consultation`, "error");
    } finally {
      setLoading(false);
    }
  };

  const saveConsultationNote = async (e, consultationId) => {
    e.preventDefault();
    const content = new FormData(e.currentTarget).get("content");
    setLoading(true);
    try {
      await request(`/consultations/${consultationId}/notes`, {
        method: "POST",
        data: { content },
      });
      notify("Clinical consultation note saved with revision versioning.");
      await loadUserData(user);
    } catch (err) {
      notify(err.response?.data?.error || "Could not save clinical note", "error");
    } finally {
      setLoading(false);
    }
  };

  const openPrescriptionModal = (consultation, isAmendment = false, priorPrescription = null) => {
    const defaultItems = isAmendment && priorPrescription
      ? priorPrescription.items.map((i) => ({ name: i.name, dosage: i.dosage, frequency: i.frequency, duration: i.duration, route: i.route, instructions: i.instructions }))
      : [{ name: "", dosage: "", frequency: "Twice daily", duration: "14 days", route: "Oral", instructions: "After meals" }];

    setPrescriptionModal({
      consultationId: consultation.id,
      isAmendment,
      prescriptionId: priorPrescription?.id,
      items: defaultItems,
      reason: isAmendment ? "Adjusted dosage based on clinical progress" : "",
    });
  };

  const submitPrescription = async (e) => {
    e.preventDefault();
    if (!prescriptionModal) return;
    setLoading(true);
    try {
      if (prescriptionModal.isAmendment) {
        await request(`/prescriptions/${prescriptionModal.prescriptionId}/amendments`, {
          method: "POST",
          data: {
            reason: prescriptionModal.reason,
            items: prescriptionModal.items,
          },
        });
        notify("Prescription amended successfully.");
      } else {
        await request(`/consultations/${prescriptionModal.consultationId}/prescriptions`, {
          method: "POST",
          data: { items: prescriptionModal.items },
        });
        notify("Prescription issued successfully.");
      }
      setPrescriptionModal(null);
      await loadUserData(user);
    } catch (err) {
      notify(err.response?.data?.error || "Prescription operation failed", "error");
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // Doctor Availability Creation & Rule Management
  // =========================================================================
  const createAvailabilitySlot = async (e) => {
    e.preventDefault();
    if (!doctorProfile?.id) return;
    setLoading(true);
    try {
      await request(`/doctors/${doctorProfile.id}/availability`, {
        method: "POST",
        data: {
          startsAt: new Date(slotForm.startsAt).toISOString(),
          endsAt: new Date(slotForm.endsAt).toISOString(),
        },
      });
      notify("Availability slot created.");
      setSlotForm({ startsAt: "", endsAt: "" });
      await loadUserData(user);
    } catch (err) {
      notify(err.response?.data?.error || "Could not add availability", "error");
    } finally {
      setLoading(false);
    }
  };

  const createRecurringRule = async (e) => {
    e.preventDefault();
    if (!doctorProfile?.id) return;
    setLoading(true);
    try {
      await request(`/doctors/${doctorProfile.id}/rules`, {
        method: "POST",
        data: {
          dayOfWeek: Number(ruleForm.dayOfWeek),
          startTime: ruleForm.startTime,
          endTime: ruleForm.endTime,
          slotDurationMinutes: Number(ruleForm.slotDurationMinutes),
        },
      });
      notify("Recurring schedule rule saved.");
      await loadUserData(user);
    } catch (err) {
      notify(err.response?.data?.error || "Could not save recurring rule", "error");
    } finally {
      setLoading(false);
    }
  };

  const createBlockedPeriod = async (e) => {
    e.preventDefault();
    if (!doctorProfile?.id) return;
    setLoading(true);
    try {
      await request(`/doctors/${doctorProfile.id}/blocked-periods`, {
        method: "POST",
        data: {
          startsAt: new Date(blockForm.startsAt).toISOString(),
          endsAt: new Date(blockForm.endsAt).toISOString(),
          reasonCategory: blockForm.reasonCategory,
        },
      });
      notify("Blocked leave period registered. Overlapping slots blocked.");
      setBlockForm({ startsAt: "", endsAt: "", reasonCategory: "PERSONAL_LEAVE" });
      await loadUserData(user);
    } catch (err) {
      notify(err.response?.data?.error || "Could not block period", "error");
    } finally {
      setLoading(false);
    }
  };

  const submitDoctorCredential = async (e) => {
    e.preventDefault();
    if (!doctorProfile?.id) return;
    setLoading(true);
    try {
      await request(`/doctors/${doctorProfile.id}/credentials`, {
        method: "POST",
        data: credentialForm,
      });
      notify("Medical credential submitted for administrative verification.");
      setCredentialForm({ credentialType: "MEDICAL_LICENSE", issuingAuthority: "", credentialReference: "" });
      await loadUserData(user);
    } catch (err) {
      notify(err.response?.data?.error || "Could not submit credential", "error");
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // Admin Operations (Doctor Verification, User Status)
  // =========================================================================
  const verifyDoctor = async (doctorId, approved) => {
    setLoading(true);
    try {
      await request(`/doctors/${doctorId}/verify`, {
        method: "POST",
        data: { verified: approved, notes: approved ? "Approved after document inspection" : "Rejected by admin" },
      });
      notify(approved ? "Doctor approved and verified!" : "Doctor application rejected.");
      await loadUserData(user);
    } catch (err) {
      notify(err.response?.data?.error || "Verification action failed", "error");
    } finally {
      setLoading(false);
    }
  };

  const toggleUserStatus = async (userId, currentActive) => {
    setLoading(true);
    try {
      await request(`/admin/users/${userId}/status`, {
        method: "PATCH",
        data: { isActive: !currentActive, reason: "Administrative governance check" },
      });
      notify(`User ${currentActive ? "suspended" : "reactivated"} successfully.`);
      await loadUserData(user);
    } catch (err) {
      notify(err.response?.data?.error || "Status update failed", "error");
    } finally {
      setLoading(false);
    }
  };

  // Consent Grant / Revoke
  const toggleConsent = async (consentType, isCurrentlyGranted) => {
    setLoading(true);
    try {
      if (isCurrentlyGranted) {
        await request(`/consent/${consentType}/revoke`, { method: "POST" });
        notify(`Consent for ${consentType.replace(/_/g, " ")} revoked.`);
      } else {
        await request("/consent", {
          method: "POST",
          data: { consentType, policyVersion: "1.0" },
        });
        notify(`Consent for ${consentType.replace(/_/g, " ")} granted.`);
      }
      await loadUserData(user);
    } catch (err) {
      notify(err.response?.data?.error || "Consent update failed", "error");
    } finally {
      setLoading(false);
    }
  };

  // Notifications read
  const markNotificationRead = async (id) => {
    try {
      await request(`/notifications/${id}/read`, { method: "PATCH" });
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date() } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (err) {
      console.error(err);
    }
  };

  const markAllNotificationsRead = async () => {
    try {
      await request("/notifications/mark-all-read", { method: "POST" });
      setNotifications((prev) => prev.map((n) => ({ ...n, readAt: new Date() })));
      setUnreadCount(0);
    } catch (err) {
      console.error(err);
    }
  };

  // =========================================================================
  // Render
  // =========================================================================
  return (
    <main className="shell">
      {/* Top Header */}
      <header className="topbar">
        <div className="brand-group">
          <a className="brand" href="#">carepath<span>.</span></a>
          <span className="tagline">Authentic Ayurvedic Telemedicine</span>
        </div>

        <div className="topbar-actions">
          {user ? (
            <>
              <div className="user-pill">
                <span>{user.name}</span>
                <span className={`role-badge ${user.role.toLowerCase()}`}>{user.role}</span>
              </div>
              <button
                className="notif-bell-btn"
                title="Notifications"
                onClick={() => setShowNotifDrawer(!showNotifDrawer)}
              >
                🔔
                {unreadCount > 0 && <span className="notif-badge">{unreadCount}</span>}
              </button>
              <button className="text-button" onClick={handleSignOut}>Sign out</button>
            </>
          ) : (
            <span className="tagline">Guest browsing · Choose a role or sign in below</span>
          )}
        </div>
      </header>

      {/* Notifications Drawer */}
      {showNotifDrawer && (
        <aside className="notif-drawer">
          <div className="notif-header">
            <strong>In-App Notifications</strong>
            {notifications.length > 0 && (
              <button className="text-button" onClick={markAllNotificationsRead}>Mark all read</button>
            )}
          </div>
          <div className="notif-list">
            {notifications.length === 0 ? (
              <p style={{ padding: "16px", color: "#8c9489", fontSize: "12px", textAlign: "center" }}>
                No notifications yet.
              </p>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`notif-item ${!n.readAt ? "unread" : ""}`}
                  onClick={() => !n.readAt && markNotificationRead(n.id)}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong style={{ color: "var(--primary-deep)" }}>{n.title || n.type}</strong>
                    <span style={{ fontSize: "10px", color: "#8c9489" }}>{new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p>{n.message}</p>
                </div>
              ))
            )}
          </div>
        </aside>
      )}



      {/* Feedback Banner */}
      {notice && (
        <div className={`notice ${notice.type}`} role="status">
          <span>{notice.message}</span>
          <button className="text-button" onClick={() => setNotice(null)}>✕</button>
        </div>
      )}

      {/* Hero */}
      <section className="hero">
        <p className="eyebrow">HOLISTIC WELLBEING · AUTHENTIC AYURVEDA</p>
        <h1>
          Rooted in ancient wisdom,<br />
          <em>guided by clinical care.</em>
        </h1>
        <p>
          Consult certified Ayurvedic practitioners, schedule personalized video consultations,
          receive customized herbal formulations, and track your wellness journey.
        </p>
      </section>

      {/* Guest Authentication Card */}
      {!user && (
        <section className="auth card">
          <div>
            <p className="eyebrow">GET STARTED</p>
            <h2 style={{ fontSize: "26px", color: "var(--primary-deep)", marginBottom: "8px" }}>
              {registering ? "Create your patient account" : "Sign in to CarePath"}
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: "13px", lineHeight: "1.6" }}>
              Access certified practitioners, manage appointments, and view clinical prescriptions.
              (Doctor profiles are verified by administrators).
            </p>
          </div>
          <form onSubmit={submitAuth}>
            {registering && (
              <>
                <input
                  placeholder="Full Name"
                  required
                  value={authForm.name}
                  onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })}
                />
                <input
                  placeholder="Phone number (+91 ...)"
                  value={authForm.phone}
                  onChange={(e) => setAuthForm({ ...authForm, phone: e.target.value })}
                />
              </>
            )}
            <input
              type="email"
              placeholder="Email address"
              required
              value={authForm.email}
              onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
            />
            <input
              type="password"
              placeholder="Password (12+ characters)"
              required
              value={authForm.password}
              onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
            />
            <button className="primary" disabled={loading}>
              {registering ? "Register as Patient" : "Sign in"} <span>→</span>
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setRegistering(!registering)}
            >
              {registering ? "Already have an account? Sign in" : "New patient? Create account"}
            </button>
          </form>
        </section>
      )}

      {/* Role Navigation Tabs */}
      {user && (
        <nav className="nav-tabs">
          {user.role === "PATIENT" && (
            <>
              <button className={`nav-tab ${activeTab === "directory" ? "active" : ""}`} onClick={() => setActiveTab("directory")}>
                Find Doctors
              </button>
              <button className={`nav-tab ${activeTab === "appointments" ? "active" : ""}`} onClick={() => setActiveTab("appointments")}>
                My Appointments ({appointments.length})
              </button>
              <button className={`nav-tab ${activeTab === "consultations" ? "active" : ""}`} onClick={() => setActiveTab("consultations")}>
                Consultation Records ({consultations.length})
              </button>
              <button className={`nav-tab ${activeTab === "consent" ? "active" : ""}`} onClick={() => setActiveTab("consent")}>
                Privacy & Consent
              </button>
            </>
          )}

          {user.role === "DOCTOR" && (
            <>
              <button className={`nav-tab ${activeTab === "workspace" ? "active" : ""}`} onClick={() => setActiveTab("workspace")}>
                Practitioner Workspace
              </button>
              <button className={`nav-tab ${activeTab === "schedule" ? "active" : ""}`} onClick={() => setActiveTab("schedule")}>
                Availability & Scheduling
              </button>
              <button className={`nav-tab ${activeTab === "profile" ? "active" : ""}`} onClick={() => setActiveTab("profile")}>
                Profile & Credentials
              </button>
              <button className={`nav-tab ${activeTab === "directory" ? "active" : ""}`} onClick={() => setActiveTab("directory")}>
                Browse All Doctors
              </button>
            </>
          )}

          {user.role === "ADMIN" && (
            <>
              <button className={`nav-tab ${activeTab === "analytics" ? "active" : ""}`} onClick={() => setActiveTab("analytics")}>
                Overview & Analytics
              </button>
              <button className={`nav-tab ${activeTab === "verification" ? "active" : ""}`} onClick={() => setActiveTab("verification")}>
                Verification Queue ({verificationQueue.length})
              </button>
              <button className={`nav-tab ${activeTab === "users" ? "active" : ""}`} onClick={() => setActiveTab("users")}>
                User Management
              </button>
              <button className={`nav-tab ${activeTab === "admin-appointments" ? "active" : ""}`} onClick={() => setActiveTab("admin-appointments")}>
                All Appointments
              </button>
              <button className={`nav-tab ${activeTab === "audit" ? "active" : ""}`} onClick={() => setActiveTab("audit")}>
                Audit Trail
              </button>
              <button className={`nav-tab ${activeTab === "directory" ? "active" : ""}`} onClick={() => setActiveTab("directory")}>
                Public Directory
              </button>
            </>
          )}
        </nav>
      )}

      {/* =================================================================== */}
      {/* TAB 1: Doctor Directory & Filters                                    */}
      {/* =================================================================== */}
      {activeTab === "directory" && (
        <section>
          <div className="card-header">
            <div>
              <p className="eyebrow">VERIFIED PRACTITIONERS</p>
              <h2>Meet our Ayurvedic Vaidyas</h2>
            </div>
          </div>

          {/* Interactive Filters */}
          <div className="filter-bar">
            <input
              className="search"
              placeholder="Search by practitioner name or bio..."
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            />
            <select
              className="filter-select"
              value={filters.specialty}
              onChange={(e) => setFilters({ ...filters, specialty: e.target.value })}
            >
              <option value="">All Specialties</option>
              {specialties.map((s) => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))}
            </select>
            <select
              className="filter-select"
              value={filters.mode}
              onChange={(e) => setFilters({ ...filters, mode: e.target.value })}
            >
              <option value="ALL">All Consultation Modes</option>
              <option value="ONLINE">Online Video</option>
              <option value="IN_PERSON">In-Person Clinic</option>
            </select>
            <select
              className="filter-select"
              value={filters.language}
              onChange={(e) => setFilters({ ...filters, language: e.target.value })}
            >
              <option value="">All Languages</option>
              <option value="English">English</option>
              <option value="Hindi">Hindi</option>
              <option value="Sanskrit">Sanskrit</option>
              <option value="Malayalam">Malayalam</option>
            </select>
          </div>

          {/* Doctors Grid */}
          {doctors.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: "40px" }}>
              <p style={{ color: "var(--text-muted)" }}>No verified doctors match your filter criteria.</p>
            </div>
          ) : (
            <div className="doctor-grid">
              {doctors.map((doctor) => (
                <article className="doctor card" key={doctor.id}>
                  <div>
                    <div className="doctor-header">
                      <div className="avatar">
                        {doctor.user.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                      </div>
                      <div>
                        <h3>{doctor.user.name}</h3>
                        <p className="specialty">{doctor.specialty}</p>
                      </div>
                    </div>

                    <div className="doctor-tags">
                      {doctor.specialtyList?.map((name) => (
                        <span key={name} className="tag-chip">{name}</span>
                      ))}
                      {doctor.experienceYears > 0 && (
                        <span className="tag-chip" style={{ background: "#edf2e8" }}>{doctor.experienceYears}y exp</span>
                      )}
                    </div>

                    {doctor.qualifications && (
                      <p className="qualifications">{doctor.qualifications}</p>
                    )}

                    <p className="bio">{doctor.bio || "Verified Ayurvedic clinician."}</p>
                    <p style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "8px" }}>
                      Languages: {doctor.languages || "English"}
                    </p>
                  </div>

                  <div>
                    <div className="fee">
                      {doctor.consultationFeeMinor == null
                        ? "Fee not listed"
                        : `₹${(doctor.consultationFeeMinor / 100).toLocaleString("en-IN")} / consultation`}
                    </div>

                    {user?.role === "PATIENT" ? (
                      <button className="primary" style={{ width: "100%" }} onClick={() => openBookingModal(doctor)}>
                        Book Consultation <span>→</span>
                      </button>
                    ) : !user ? (
                      <button
                        className="secondary"
                        style={{ width: "100%" }}
                        onClick={() => notify("Sign in or use a demo account to book consultations.", "error")}
                      >
                        Sign in to book
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* =================================================================== */}
      {/* TAB 2: Patient Appointments (Book, Cancel, Reschedule)               */}
      {/* =================================================================== */}
      {activeTab === "appointments" && (
        <section>
          <div className="card-header">
            <div>
              <p className="eyebrow">SCHEDULED SESSIONS</p>
              <h2>Your Appointments</h2>
            </div>
          </div>

          {appointments.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: "40px" }}>
              <p style={{ color: "var(--text-muted)" }}>You have no scheduled appointments yet.</p>
              <button className="primary" style={{ marginTop: "16px" }} onClick={() => setActiveTab("directory")}>
                Find a Doctor and Book Now <span>→</span>
              </button>
            </div>
          ) : (
            appointments.map((appt) => (
              <div className="appointment-card card" key={appt.id}>
                <div className="appointment-meta">
                  <strong>Dr. {appt.doctor?.name || "Practitioner"}</strong>
                  <p>
                    🕒 {new Date(appt.slot.startsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                    {" · "}Mode: {appt.mode}
                  </p>
                  {appt.reasonForVisit && (
                    <p style={{ fontStyle: "italic", color: "#556450" }}>
                      Reason: "{appt.reasonForVisit}"
                    </p>
                  )}
                </div>

                <div className="appointment-actions">
                  <span className={`status ${appt.status.toLowerCase()}`}>{appt.status.replace("_", " ")}</span>

                  {/* Status History Trigger */}
                  {appt.statusHistory && appt.statusHistory.length > 0 && (
                    <button
                      className="secondary"
                      onClick={() => setHistoryModal({ appointment: appt })}
                    >
                      History ({appt.statusHistory.length})
                    </button>
                  )}

                  {/* Actions for Booked Appointments */}
                  {appt.status === "BOOKED" && new Date(appt.slot.startsAt) > new Date() && (
                    <>
                      <button className="secondary" onClick={() => openRescheduleModal(appt)}>
                        Reschedule
                      </button>
                      <button className="danger-button" onClick={() => openCancelModal(appt)}>
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </section>
      )}

      {/* =================================================================== */}
      {/* TAB 3: Patient Clinical & Consultation History                      */}
      {/* =================================================================== */}
      {activeTab === "consultations" && (
        <section>
          <div className="card-header">
            <div>
              <p className="eyebrow">MEDICAL RECORDS</p>
              <h2>Consultation Records & Prescriptions</h2>
            </div>
          </div>

          {consultations.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: "40px" }}>
              <p style={{ color: "var(--text-muted)" }}>No completed consultation records yet.</p>
            </div>
          ) : (
            consultations.map((consult) => (
              <article className="card" style={{ marginBottom: "20px" }} key={consult.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-color)", paddingBottom: "12px", marginBottom: "14px" }}>
                  <div>
                    <h3 style={{ color: "var(--primary-deep)" }}>
                      Consultation with Dr. {consult.appointment?.doctor?.name}
                    </h3>
                    <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "4px 0 0" }}>
                      Date: {new Date(consult.appointment?.slot?.startsAt).toLocaleString()} · Status: {consult.appointment?.status}
                    </p>
                  </div>
                  <span className={`status ${consult.appointment?.status.toLowerCase()}`}>
                    {consult.appointment?.status}
                  </span>
                </div>

                {/* Doctor Note */}
                <div className="clinical-box">
                  <h4>Clinical Notes (Version {consult.note?.version || 1})</h4>
                  <p style={{ fontSize: "13px", lineHeight: "1.6", color: "#3a4738" }}>
                    {consult.note?.content || "No clinical notes documented for this consultation."}
                  </p>
                </div>

                {/* Prescriptions */}
                {consult.prescriptions && consult.prescriptions.length > 0 && (
                  <div>
                    <h4 style={{ color: "var(--primary-deep)", margin: "16px 0 10px", fontSize: "14px" }}>
                      Prescribed Ayurvedic Regimen ({consult.prescriptions.length} Versions)
                    </h4>
                    {consult.prescriptions.map((rx) => (
                      <div className="clinical-box" key={rx.id} style={{ background: "#fcfdfb" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                          <strong style={{ color: "var(--primary)" }}>Prescription v{rx.version}</strong>
                          <span style={{ fontSize: "11px", color: "#778374" }}>
                            Issued: {new Date(rx.issuedAt).toLocaleDateString()}
                          </span>
                        </div>
                        {rx.items?.map((item) => (
                          <div className="prescription-item-row" key={item.id}>
                            <strong>{item.name}</strong>
                            <span>{item.dosage}</span>
                            <span>{item.frequency}</span>
                            <span>{item.duration}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))
          )}
        </section>
      )}

      {/* =================================================================== */}
      {/* TAB 4: Patient Consent & Privacy Records                            */}
      {/* =================================================================== */}
      {activeTab === "consent" && (
        <section>
          <div className="card-header">
            <div>
              <p className="eyebrow">PATIENT GOVERNANCE</p>
              <h2>Consent & Privacy Notice Registry</h2>
            </div>
          </div>

          <div className="card" style={{ marginBottom: "20px" }}>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: "1.6", marginBottom: "16px" }}>
              In accordance with telemedicine guidelines and patient health privacy standards,
              you may view and manage your signed consent declarations below.
            </p>

            <div style={{ display: "grid", gap: "14px" }}>
              {[
                { type: "TELEMEDICINE_TREATMENT_CONSENT", title: "Telemedicine Treatment & Electronic Consultation Consent (v1.0)" },
                { type: "DATA_PROCESSING_PRIVACY_NOTICE", title: "Health Data Processing & Privacy Notice (v1.0)" },
                { type: "ELECTRONIC_HEALTH_RECORDS_CONSENT", title: "Electronic Health Records Sharing with Authorized Clinicians (v1.0)" },
              ].map((item) => {
                const existing = consentRecords.find((r) => r.consentType === item.type && r.status === "GRANTED");
                return (
                  <div key={item.type} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", border: "1px solid var(--border-color)", borderRadius: "10px" }}>
                    <div>
                      <strong style={{ fontSize: "13px", color: "var(--primary-deep)", display: "block" }}>{item.title}</strong>
                      <span style={{ fontSize: "11px", color: existing ? "#3d6a36" : "#8c9489" }}>
                        {existing ? `Active since ${new Date(existing.recordedAt).toLocaleDateString()}` : "Not currently signed"}
                      </span>
                    </div>
                    <button
                      className={existing ? "secondary" : "primary"}
                      onClick={() => toggleConsent(item.type, !!existing)}
                    >
                      {existing ? "Revoke Consent" : "Grant Consent"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* =================================================================== */}
      {/* TAB 5: Doctor Practitioner Workspace                                */}
      {/* =================================================================== */}
      {activeTab === "workspace" && user?.role === "DOCTOR" && (
        <section>
          <div className="card-header">
            <div>
              <p className="eyebrow">PRACTITIONER DASHBOARD</p>
              <h2>Consultation Workspace</h2>
            </div>
            {doctorProfile?.verified ? (
              <span className="status verified">Verified Practitioner</span>
            ) : (
              <span className="status pending">Pending Admin Verification</span>
            )}
          </div>

          {!doctorProfile?.verified && (
            <div className="notice" style={{ background: "#fbf3e5", color: "#9b681e", borderColor: "#f2dfbf" }}>
              Your practitioner profile is awaiting administrative credential verification. Once approved, you can publish availability and accept bookings.
            </div>
          )}

          <h3 style={{ margin: "24px 0 14px", color: "var(--primary-deep)" }}>
            Assigned Patient Consultations ({appointments.length})
          </h3>

          {appointments.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: "30px" }}>
              <p style={{ color: "var(--text-muted)" }}>No booked appointments found.</p>
            </div>
          ) : (
            appointments.map((appt) => {
              const consult = consultations.find((c) => c.appointmentId === appt.id);
              return (
                <article className="card" style={{ marginBottom: "20px" }} key={appt.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", borderBottom: "1px solid var(--border-color)", paddingBottom: "12px", marginBottom: "14px" }}>
                    <div>
                      <strong style={{ fontSize: "16px", color: "var(--primary-deep)" }}>
                        Patient: {appt.patient?.name || "Patient"}
                      </strong>
                      <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "4px 0 0" }}>
                        🕒 {new Date(appt.slot.startsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                        {" · "}Mode: {appt.mode}
                      </p>
                      {appt.reasonForVisit && (
                        <p style={{ fontSize: "12px", color: "#546450", margin: "4px 0 0" }}>
                          Reason: "{appt.reasonForVisit}"
                        </p>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span className={`status ${appt.status.toLowerCase()}`}>{appt.status.replace("_", " ")}</span>

                      {appt.status === "BOOKED" && consult && (
                        <button className="primary" onClick={() => updateConsultationStatus(consult.id, "start")}>
                          Start Consultation <span>→</span>
                        </button>
                      )}

                      {appt.status === "IN_PROGRESS" && consult && (
                        <button className="primary" onClick={() => updateConsultationStatus(consult.id, "complete")}>
                          Conclude Consultation <span>✓</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Note & Prescription editor if consult exists */}
                  {consult && (
                    <div>
                      {/* Clinical Note Form */}
                      <form onSubmit={(e) => saveConsultationNote(e, consult.id)} style={{ marginBottom: "16px" }}>
                        <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "var(--primary-deep)", marginBottom: "6px" }}>
                          Clinical Note (Version {consult.note?.version || 1})
                        </label>
                        <textarea
                          name="content"
                          required
                          defaultValue={consult.note?.content || ""}
                          placeholder="Document patient pulse (Nadi), constitution (Prakriti/Vikriti), clinical observations and dietary guidance..."
                          style={{ width: "100%", minHeight: "85px", border: "1px solid #dbe2d6", borderRadius: "8px", padding: "10px", font: "inherit", fontSize: "13px" }}
                        />
                        <button className="secondary" style={{ marginTop: "8px" }}>Save / Amend Note</button>
                      </form>

                      {/* Prescriptions Actions */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #edf0ea", paddingTop: "12px" }}>
                        <strong style={{ fontSize: "13px", color: "var(--primary-deep)" }}>
                          Prescriptions ({consult.prescriptions?.length || 0})
                        </strong>
                        <button className="secondary" onClick={() => openPrescriptionModal(consult, false)}>
                          + Issue New Prescription
                        </button>
                      </div>

                      {consult.prescriptions?.map((rx) => (
                        <div key={rx.id} className="clinical-box" style={{ marginTop: "10px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                            <strong>Prescription v{rx.version} ({rx.status})</strong>
                            <button
                              className="text-button"
                              onClick={() => openPrescriptionModal(consult, true, rx)}
                            >
                              Amend Version
                            </button>
                          </div>
                          {rx.items?.map((i) => (
                            <div key={i.id} className="prescription-item-row">
                              <strong>{i.name}</strong>
                              <span>{i.dosage}</span>
                              <span>{i.frequency}</span>
                              <span>{i.duration}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              );
            })
          )}
        </section>
      )}

      {/* =================================================================== */}
      {/* TAB 6: Doctor Availability & Scheduling Manager                    */}
      {/* =================================================================== */}
      {activeTab === "schedule" && user?.role === "DOCTOR" && (
        <section>
          <div className="card-header">
            <div>
              <p className="eyebrow">SCHEDULE CONFIGURATION</p>
              <h2>Manage Availability & Recurring Rules</h2>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "24px" }}>
            {/* Create Single Slot */}
            <div className="card">
              <h3 style={{ fontSize: "16px", color: "var(--primary-deep)", marginBottom: "12px" }}>Add Individual Slot</h3>
              <form onSubmit={createAvailabilitySlot} style={{ display: "grid", gap: "10px" }}>
                <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  Slot Starts At
                  <input
                    type="datetime-local"
                    className="form-input"
                    required
                    value={slotForm.startsAt}
                    onChange={(e) => setSlotForm({ ...slotForm, startsAt: e.target.value })}
                  />
                </label>
                <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  Slot Ends At
                  <input
                    type="datetime-local"
                    className="form-input"
                    required
                    value={slotForm.endsAt}
                    onChange={(e) => setSlotForm({ ...slotForm, endsAt: e.target.value })}
                  />
                </label>
                <button className="primary" style={{ marginTop: "4px" }}>Publish Slot <span>+</span></button>
              </form>
            </div>

            {/* Block Leave Period */}
            <div className="card">
              <h3 style={{ fontSize: "16px", color: "var(--primary-deep)", marginBottom: "12px" }}>Block Leave / Time Off</h3>
              <form onSubmit={createBlockedPeriod} style={{ display: "grid", gap: "10px" }}>
                <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  Leave Starts
                  <input
                    type="datetime-local"
                    className="form-input"
                    required
                    value={blockForm.startsAt}
                    onChange={(e) => setBlockForm({ ...blockForm, startsAt: e.target.value })}
                  />
                </label>
                <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  Leave Ends
                  <input
                    type="datetime-local"
                    className="form-input"
                    required
                    value={blockForm.endsAt}
                    onChange={(e) => setBlockForm({ ...blockForm, endsAt: e.target.value })}
                  />
                </label>
                <button className="danger-button" style={{ marginTop: "4px", padding: "10px" }}>Block Date Range</button>
              </form>
            </div>
          </div>

          {/* Published Future Slots */}
          <div className="card" style={{ marginBottom: "24px" }}>
            <h3 style={{ fontSize: "16px", color: "var(--primary-deep)", marginBottom: "14px" }}>
              Active Published Slots ({doctorSlots.length})
            </h3>
            {doctorSlots.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>No active upcoming slots published.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "10px" }}>
                {doctorSlots.map((s) => (
                  <div key={s.id} style={{ padding: "10px 14px", border: "1px solid var(--border-color)", borderRadius: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "12px", fontWeight: "500" }}>{new Date(s.startsAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
                    <span className="status available">AVAILABLE</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* =================================================================== */}
      {/* TAB 7: Doctor Profile & Credentials                                 */}
      {/* =================================================================== */}
      {activeTab === "profile" && user?.role === "DOCTOR" && (
        <section>
          <div className="card-header">
            <div>
              <p className="eyebrow">DOCTOR CREDENTIALING</p>
              <h2>Practitioner Qualifications & Licenses</h2>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            {/* Profile Overview */}
            <div className="card">
              <h3 style={{ fontSize: "16px", color: "var(--primary-deep)", marginBottom: "12px" }}>Professional Profile</h3>
              <div style={{ fontSize: "13px", lineHeight: "1.8", color: "var(--text-main)" }}>
                <p><strong>Primary Specialty:</strong> {doctorProfile?.specialty}</p>
                <p><strong>Qualifications:</strong> {doctorProfile?.qualifications || "Not specified"}</p>
                <p><strong>Experience:</strong> {doctorProfile?.experienceYears || 0} Years</p>
                <p><strong>Languages:</strong> {doctorProfile?.languages || "English, Hindi"}</p>
                <p><strong>Consultation Fee:</strong> ₹{((doctorProfile?.consultationFeeMinor || 0) / 100).toLocaleString()}</p>
                <p><strong>Bio:</strong> {doctorProfile?.bio}</p>
              </div>
            </div>

            {/* Submit New Credential */}
            <div className="card">
              <h3 style={{ fontSize: "16px", color: "var(--primary-deep)", marginBottom: "12px" }}>Submit Medical Credential</h3>
              <form onSubmit={submitDoctorCredential} style={{ display: "grid", gap: "10px" }}>
                <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  Credential Type
                  <select
                    className="form-input"
                    value={credentialForm.credentialType}
                    onChange={(e) => setCredentialForm({ ...credentialForm, credentialType: e.target.value })}
                  >
                    <option value="MEDICAL_LICENSE">State Medical Council License</option>
                    <option value="DEGREE">BAMS / MD Degree</option>
                    <option value="SPECIALIST_CERTIFICATE">Specialization Fellowship</option>
                  </select>
                </label>
                <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  Issuing Authority
                  <input
                    className="form-input"
                    required
                    placeholder="e.g. Central Council of Indian Medicine"
                    value={credentialForm.issuingAuthority}
                    onChange={(e) => setCredentialForm({ ...credentialForm, issuingAuthority: e.target.value })}
                  />
                </label>
                <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  Registration / Credential Number
                  <input
                    className="form-input"
                    required
                    placeholder="e.g. AYUSH-MH-2021-9988"
                    value={credentialForm.credentialReference}
                    onChange={(e) => setCredentialForm({ ...credentialForm, credentialReference: e.target.value })}
                  />
                </label>
                <button className="primary" style={{ marginTop: "4px" }}>Submit for Admin Review <span>→</span></button>
              </form>
            </div>
          </div>
        </section>
      )}

      {/* =================================================================== */}
      {/* TAB 8: Administrator Overview & Analytics                           */}
      {/* =================================================================== */}
      {activeTab === "analytics" && user?.role === "ADMIN" && adminOverview && (
        <section>
          <div className="card-header">
            <div>
              <p className="eyebrow">CLINICAL GOVERNANCE</p>
              <h2>Platform Analytics & KPIs</h2>
            </div>
          </div>

          <div className="stats-grid">
            <div className="stat-box">
              <strong>{adminOverview.patients}</strong>
              <span>Registered Patients</span>
            </div>
            <div className="stat-box">
              <strong>{adminOverview.activeVerifiedDoctors}</strong>
              <span>Verified Doctors</span>
            </div>
            <div className="stat-box">
              <strong>{adminOverview.pendingDoctorVerifications}</strong>
              <span>Pending Verifications</span>
            </div>
            <div className="stat-box">
              <strong>{adminOverview.specialties}</strong>
              <span>Active Specialties</span>
            </div>
          </div>

          {/* Appointment Status Breakdown */}
          <div className="card" style={{ marginBottom: "20px" }}>
            <h3 style={{ fontSize: "16px", color: "var(--primary-deep)", marginBottom: "14px" }}>
              Appointment Lifetime Status Breakdown
            </h3>
            <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
              {adminOverview.appointmentsByStatus.map((row) => (
                <div key={row.status} style={{ padding: "12px 18px", border: "1px solid var(--border-color)", borderRadius: "8px", minWidth: "130px" }}>
                  <strong style={{ fontSize: "20px", color: "var(--primary-deep)", display: "block" }}>{row._count._all}</strong>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase" }}>{row.status.replace("_", " ")}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* =================================================================== */}
      {/* TAB 9: Admin Verification Queue                                    */}
      {/* =================================================================== */}
      {activeTab === "verification" && user?.role === "ADMIN" && (
        <section>
          <div className="card-header">
            <div>
              <p className="eyebrow">ADMINISTRATIVE QUEUE</p>
              <h2>Doctor Verification Applications ({verificationQueue.length})</h2>
            </div>
          </div>

          {verificationQueue.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: "40px" }}>
              <p style={{ color: "var(--text-muted)" }}>Verification queue is currently clear.</p>
            </div>
          ) : (
            verificationQueue.map((doc) => (
              <div className="card" key={doc.id} style={{ marginBottom: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <div>
                    <h3 style={{ margin: 0, color: "var(--primary-deep)" }}>{doc.user?.name}</h3>
                    <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
                      {doc.user?.email} · Specialty: {doc.specialty} · Experience: {doc.experienceYears}y
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button className="primary" onClick={() => verifyDoctor(doc.id, true)}>Approve & Verify</button>
                    <button className="danger-button" onClick={() => verifyDoctor(doc.id, false)}>Reject</button>
                  </div>
                </div>

                <div style={{ background: "#f8faf6", padding: "12px", borderRadius: "8px", fontSize: "12px" }}>
                  <strong>Submitted Credentials ({doc.credentials?.length || 0}):</strong>
                  {doc.credentials?.map((c) => (
                    <div key={c.id} style={{ marginTop: "6px" }}>
                      • {c.credentialType}: <em>{c.credentialReference}</em> issued by {c.issuingAuthority} ({c.verificationStatus})
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </section>
      )}

      {/* =================================================================== */}
      {/* TAB 10: Admin User Management                                       */}
      {/* =================================================================== */}
      {activeTab === "users" && user?.role === "ADMIN" && (
        <section>
          <div className="card-header">
            <div>
              <p className="eyebrow">USER ACCOUNTS</p>
              <h2>Platform User Management</h2>
            </div>
          </div>

          <div className="card" style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Registered</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {adminUsers.map((u) => (
                  <tr key={u.id}>
                    <td><strong>{u.name}</strong></td>
                    <td>{u.email}</td>
                    <td><span className={`role-badge ${u.role.toLowerCase()}`}>{u.role}</span></td>
                    <td>
                      <span className={`status ${u.isActive ? "verified" : "cancelled"}`}>
                        {u.isActive ? "ACTIVE" : "SUSPENDED"}
                      </span>
                    </td>
                    <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td>
                      {u.id !== user.id && (
                        <button
                          className={u.isActive ? "danger-button" : "secondary"}
                          onClick={() => toggleUserStatus(u.id, u.isActive)}
                        >
                          {u.isActive ? "Suspend" : "Reactivate"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* =================================================================== */}
      {/* TAB 11: Admin System-Wide Appointments                              */}
      {/* =================================================================== */}
      {activeTab === "admin-appointments" && user?.role === "ADMIN" && (
        <section>
          <div className="card-header">
            <div>
              <p className="eyebrow">SYSTEM MONITORING</p>
              <h2>All Platform Appointments</h2>
            </div>
          </div>

          <div className="card" style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Appointment ID</th>
                  <th>Patient</th>
                  <th>Doctor</th>
                  <th>Scheduled Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {adminAppointments.map((a) => (
                  <tr key={a.id}>
                    <td><code>{a.id.slice(0, 8)}...</code></td>
                    <td>{a.patient?.name}</td>
                    <td>Dr. {a.doctor?.name}</td>
                    <td>{new Date(a.slot.startsAt).toLocaleString()}</td>
                    <td><span className={`status ${a.status.toLowerCase()}`}>{a.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* =================================================================== */}
      {/* TAB 12: Admin Audit Trail                                          */}
      {/* =================================================================== */}
      {activeTab === "audit" && user?.role === "ADMIN" && (
        <section>
          <div className="card-header">
            <div>
              <p className="eyebrow">SECURITY LOGGING</p>
              <h2>System Audit Trail</h2>
            </div>
          </div>

          <div className="card" style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Resource</th>
                  <th>Outcome</th>
                  <th>Correlation ID</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{new Date(log.createdAt).toLocaleString()}</td>
                    <td><strong>{log.action}</strong></td>
                    <td>{log.actor?.name || log.actorId ? `${log.actor?.name || "User"} (${log.actor?.role || "Actor"})` : "System"}</td>
                    <td>{log.resourceType}</td>
                    <td><span className={`status ${log.outcome === "success" ? "verified" : "cancelled"}`}>{log.outcome}</span></td>
                    <td><code style={{ fontSize: "10px" }}>{String(log.correlationId).slice(0, 16)}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* =================================================================== */}
      {/* MODAL 1: Book Consultation                                          */}
      {/* =================================================================== */}
      {bookingModal && (
        <div className="modal-overlay" onClick={() => setBookingModal(null)}>
          <div className="modal-window" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Book Consultation</h3>
              <button className="close-btn" onClick={() => setBookingModal(null)}>✕</button>
            </div>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "14px" }}>
              Practitioner: <strong>{bookingModal.doctor.user.name}</strong> ({bookingModal.doctor.specialty})
            </p>

            <form onSubmit={(e) => { e.preventDefault(); confirmBooking(); }} style={{ display: "grid", gap: "12px" }}>
              <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                Select Available Slot
                <select
                  className="form-input"
                  value={bookingModal.slotId}
                  onChange={(e) => setBookingModal({ ...bookingModal, slotId: e.target.value })}
                >
                  {bookingModal.slots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {new Date(s.startsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                Consultation Mode
                <select
                  className="form-input"
                  value={bookingModal.mode}
                  onChange={(e) => setBookingModal({ ...bookingModal, mode: e.target.value })}
                >
                  <option value="ONLINE">Online Video</option>
                  <option value="IN_PERSON">In-Person Clinic</option>
                </select>
              </label>

              <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                Reason for Visit / Primary Symptoms
                <textarea
                  className="form-input"
                  rows="3"
                  required
                  placeholder="Describe digestion, sleep patterns, stress, or existing health conditions..."
                  value={bookingModal.reasonForVisit}
                  onChange={(e) => setBookingModal({ ...bookingModal, reasonForVisit: e.target.value })}
                />
              </label>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
                <button type="button" className="secondary" onClick={() => setBookingModal(null)}>Cancel</button>
                <button type="submit" className="primary" disabled={loading}>
                  Confirm Booking <span>→</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL 2: Reschedule Appointment                                     */}
      {/* =================================================================== */}
      {rescheduleModal && (
        <div className="modal-overlay" onClick={() => setRescheduleModal(null)}>
          <div className="modal-window" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Reschedule Appointment</h3>
              <button className="close-btn" onClick={() => setRescheduleModal(null)}>✕</button>
            </div>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "14px" }}>
              Currently scheduled for: <strong>{new Date(rescheduleModal.appointment.slot.startsAt).toLocaleString()}</strong>
            </p>

            <form onSubmit={(e) => { e.preventDefault(); confirmReschedule(); }} style={{ display: "grid", gap: "12px" }}>
              <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                Choose New Slot
                <select
                  className="form-input"
                  value={rescheduleModal.slotId}
                  onChange={(e) => setRescheduleModal({ ...rescheduleModal, slotId: e.target.value })}
                >
                  {rescheduleModal.slots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {new Date(s.startsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                Reason for Rescheduling
                <input
                  className="form-input"
                  required
                  value={rescheduleModal.reason}
                  onChange={(e) => setRescheduleModal({ ...rescheduleModal, reason: e.target.value })}
                />
              </label>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
                <button type="button" className="secondary" onClick={() => setRescheduleModal(null)}>Back</button>
                <button type="submit" className="primary" disabled={loading}>Confirm New Time <span>→</span></button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL 3: Cancel Appointment Confirmation                            */}
      {/* =================================================================== */}
      {cancelModal && (
        <div className="modal-overlay" onClick={() => setCancelModal(null)}>
          <div className="modal-window" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Cancel Appointment</h3>
              <button className="close-btn" onClick={() => setCancelModal(null)}>✕</button>
            </div>
            <p style={{ fontSize: "13px", color: "#a13d31", marginBottom: "14px" }}>
              Are you sure you want to cancel your consultation scheduled for{" "}
              <strong>{new Date(cancelModal.appointment.slot.startsAt).toLocaleString()}</strong>?
            </p>

            <form onSubmit={(e) => { e.preventDefault(); confirmCancel(); }} style={{ display: "grid", gap: "12px" }}>
              <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                Cancellation Reason
                <input
                  className="form-input"
                  required
                  value={cancelModal.reason}
                  onChange={(e) => setCancelModal({ ...cancelModal, reason: e.target.value })}
                />
              </label>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
                <button type="button" className="secondary" onClick={() => setCancelModal(null)}>Keep Appointment</button>
                <button type="submit" className="danger-button" disabled={loading}>Confirm Cancellation</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL 4: Appointment State History Viewer                          */}
      {/* =================================================================== */}
      {historyModal && (
        <div className="modal-overlay" onClick={() => setHistoryModal(null)}>
          <div className="modal-window" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Appointment Lifecycle History</h3>
              <button className="close-btn" onClick={() => setHistoryModal(null)}>✕</button>
            </div>
            <div style={{ display: "grid", gap: "10px" }}>
              {historyModal.appointment.statusHistory?.map((h) => (
                <div key={h.id} style={{ padding: "10px 14px", border: "1px solid var(--border-color)", borderRadius: "8px", background: "#fafbf9" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong>{h.previousStatus} → {h.newStatus}</strong>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{new Date(h.timestamp).toLocaleString()}</span>
                  </div>
                  {h.reason && <p style={{ fontSize: "12px", color: "#5d6958", margin: "4px 0 0" }}>Reason: {h.reason}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL 5: Prescription Builder / Amendment Form                      */}
      {/* =================================================================== */}
      {prescriptionModal && (
        <div className="modal-overlay" onClick={() => setPrescriptionModal(null)}>
          <div className="modal-window" style={{ maxWidth: "620px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{prescriptionModal.isAmendment ? "Amend Prescription Version" : "Issue New Prescription"}</h3>
              <button className="close-btn" onClick={() => setPrescriptionModal(null)}>✕</button>
            </div>

            <form onSubmit={submitPrescription} style={{ display: "grid", gap: "14px" }}>
              {prescriptionModal.isAmendment && (
                <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  Clinical Justification for Amendment
                  <input
                    className="form-input"
                    required
                    value={prescriptionModal.reason}
                    onChange={(e) => setPrescriptionModal({ ...prescriptionModal, reason: e.target.value })}
                  />
                </label>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong style={{ fontSize: "13px", color: "var(--primary-deep)" }}>Prescription Items:</strong>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    setPrescriptionModal({
                      ...prescriptionModal,
                      items: [
                        ...prescriptionModal.items,
                        { name: "", dosage: "", frequency: "Twice daily", duration: "14 days", route: "Oral", instructions: "After meals" },
                      ],
                    })
                  }
                >
                  + Add Medicine
                </button>
              </div>

              {prescriptionModal.items.map((item, idx) => (
                <div key={idx} style={{ padding: "12px", border: "1px solid var(--border-color)", borderRadius: "8px", background: "#fcfdfa", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <input
                    placeholder="Ayurvedic Formulation / Medicine Name"
                    required
                    value={item.name}
                    onChange={(e) => {
                      const newItems = [...prescriptionModal.items];
                      newItems[idx].name = e.target.value;
                      setPrescriptionModal({ ...prescriptionModal, items: newItems });
                    }}
                  />
                  <input
                    placeholder="Dosage (e.g. 500mg, 1 tsp)"
                    required
                    value={item.dosage}
                    onChange={(e) => {
                      const newItems = [...prescriptionModal.items];
                      newItems[idx].dosage = e.target.value;
                      setPrescriptionModal({ ...prescriptionModal, items: newItems });
                    }}
                  />
                  <input
                    placeholder="Frequency (e.g. Twice daily)"
                    value={item.frequency}
                    onChange={(e) => {
                      const newItems = [...prescriptionModal.items];
                      newItems[idx].frequency = e.target.value;
                      setPrescriptionModal({ ...prescriptionModal, items: newItems });
                    }}
                  />
                  <input
                    placeholder="Duration (e.g. 21 days)"
                    required
                    value={item.duration}
                    onChange={(e) => {
                      const newItems = [...prescriptionModal.items];
                      newItems[idx].duration = e.target.value;
                      setPrescriptionModal({ ...prescriptionModal, items: newItems });
                    }}
                  />
                  <input
                    style={{ gridColumn: "1 / -1" }}
                    placeholder="Instructions (e.g. Take with warm water after meals)"
                    value={item.instructions}
                    onChange={(e) => {
                      const newItems = [...prescriptionModal.items];
                      newItems[idx].instructions = e.target.value;
                      setPrescriptionModal({ ...prescriptionModal, items: newItems });
                    }}
                  />
                </div>
              ))}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
                <button type="button" className="secondary" onClick={() => setPrescriptionModal(null)}>Cancel</button>
                <button type="submit" className="primary" disabled={loading}>
                  {prescriptionModal.isAmendment ? "Issue Amendment" : "Issue Prescription"} <span>→</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer>
        CarePath Telemedicine Platform · Synthetic Demonstration Dataset · Non-Clinical Evaluation Build<br />
        Preserving Holistic Ayurvedic Principles · End-to-End Enterprise Architecture
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
