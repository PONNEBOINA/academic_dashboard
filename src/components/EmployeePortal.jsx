// src/components/EmployeePortal.jsx
// Complete, isolated Employee Portal: Signup, Login, Leave Application,
// My Requests, Leave History, and Official Approval Letter.

import React, { useState, useEffect, useMemo } from 'react';
import * as leaveApi from '../leaveApi.js';

// Format YYYY-MM-DD to DD/MM/YYYY
function formatDateDisplay(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

// Format ISO date to readable date: e.g. "05 Sep 2026"
function formatReadableDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return String(isoStr);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const day = String(d.getDate()).padStart(2, '0');
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

// Calculate days between two YYYY-MM-DD dates inclusive
function computeDays(startStr, endStr) {
  if (!startStr) return 0;
  const s = new Date(`${startStr}T00:00:00`);
  const e = endStr ? new Date(`${endStr}T00:00:00`) : s;
  const diffTime = e.getTime() - s.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
  return diffDays > 0 ? diffDays : 1;
}

// Today's date YYYY-MM-DD
function getTodayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function EmployeePortal({ onSwitchToHod, currentTheme, onToggleTheme }) {
  // ── Authentication & View State ────────────────────────────────────────────
  const [employee, setEmployee] = useState(() => leaveApi.getStoredEmployee());
  const [authView, setAuthView] = useState('login'); // 'login' | 'signup'
  const [activeTab, setActiveTab] = useState('apply'); // 'apply' | 'requests' | 'history'

  // Login form state
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Signup form state
  const [signupData, setSignupData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    employeeId: '',
    role: 'Assistant Professor',
    subjects: ''
  });
  const [signupErrors, setSignupErrors] = useState({});
  const [signupSuccessMsg, setSignupSuccessMsg] = useState('');
  const [signupLoading, setSignupLoading] = useState(false);

  // Leave application form state
  const [isRange, setIsRange] = useState(false);
  const [startDate, setStartDate] = useState(() => getTodayString());
  const [endDate, setEndDate] = useState(() => getTodayString());
  const [leaveType, setLeaveType] = useState('Casual Leave');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Requests & History state
  const [myRequests, setMyRequests] = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [historyFilter, setHistoryFilter] = useState('All'); // 'All' | 'Approved' | 'Rejected' | 'Pending'

  // Modals state
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [activeLetterRequest, setActiveLetterRequest] = useState(null);

  // Load employee profile on mount if token exists
  useEffect(() => {
    if (leaveApi.hasEmployeeToken()) {
      leaveApi.getEmployeeProfile()
        .then(res => {
          if (res.employee) {
            setEmployee(res.employee);
            leaveApi.saveEmployeeSession(leaveApi.getEmployeeToken(), res.employee);
          }
        })
        .catch(() => {
          leaveApi.clearEmployeeSession();
          setEmployee(null);
        });
    }
  }, []);

  // Fetch leave requests when employee is logged in
  const fetchRequests = async () => {
    if (!employee) return;
    setRequestsLoading(true);
    try {
      const data = await leaveApi.getMyLeaveRequests();
      setMyRequests(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load my leave requests:', err);
    } finally {
      setRequestsLoading(false);
    }
  };

  useEffect(() => {
    if (employee) {
      fetchRequests();
    }
  }, [employee]);

  // Compute number of days and display label
  const calculatedDays = useMemo(() => {
    if (!startDate) return 0;
    return isRange ? computeDays(startDate, endDate) : 1;
  }, [startDate, endDate, isRange]);

  const selectedDateLabel = useMemo(() => {
    if (!startDate) return '';
    const startFmt = formatDateDisplay(startDate);
    if (isRange && endDate && endDate !== startDate) {
      return `${startFmt} - ${formatDateDisplay(endDate)}`;
    }
    return startFmt;
  }, [startDate, endDate, isRange]);

  // ── Handle Login ───────────────────────────────────────────────────────────
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setLoginError('');
    if (!loginIdentifier || !loginPassword) {
      setLoginError('Please enter both Email/Employee ID and password.');
      return;
    }

    setLoginLoading(true);
    try {
      const data = await leaveApi.employeeLogin(loginIdentifier, loginPassword);
      setEmployee(data.employee);
      setLoginIdentifier('');
      setLoginPassword('');
    } catch (err) {
      setLoginError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoginLoading(false);
    }
  };

  // ── Handle Signup ──────────────────────────────────────────────────────────
  const validateSignup = () => {
    const errs = {};
    if (!signupData.fullName.trim()) errs.fullName = 'Full Name is required.';
    if (!signupData.email.trim()) {
      errs.email = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signupData.email.trim())) {
      errs.email = 'Please enter a valid email address.';
    }
    if (!signupData.employeeId.trim()) errs.employeeId = 'Employee ID is required.';
    if (!signupData.role.trim()) errs.role = 'Role is required.';
    if (!signupData.subjects.trim()) errs.subjects = 'Subject(s) taught is required.';
    if (!signupData.password) {
      errs.password = 'Password is required.';
    } else if (signupData.password.length < 6) {
      errs.password = 'Password must be at least 6 characters.';
    }
    if (signupData.password !== signupData.confirmPassword) {
      errs.confirmPassword = 'Passwords do not match.';
    }
    setSignupErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSignupSubmit = async (e) => {
    e.preventDefault();
    setSignupSuccessMsg('');
    if (!validateSignup()) return;

    setSignupLoading(true);
    try {
      const res = await leaveApi.employeeSignup(signupData);
      setSignupSuccessMsg(res.message || 'Account created successfully! You can now log in.');
      setSignupData({
        fullName: '',
        email: '',
        password: '',
        confirmPassword: '',
        employeeId: '',
        role: 'Assistant Professor',
        subjects: ''
      });
      setSignupErrors({});
      // Switch back to login view after short delay or immediately
      setTimeout(() => {
        setAuthView('login');
      }, 1800);
    } catch (err) {
      setSignupErrors({ general: err.message || 'Signup failed. Please try again.' });
    } finally {
      setSignupLoading(false);
    }
  };

  // ── Handle Leave Submit ────────────────────────────────────────────────────
  const handleLeaveSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!startDate) {
      setFormError('Please select a leave date.');
      return;
    }
    if (isRange && endDate < startDate) {
      setFormError('End date cannot be earlier than start date.');
      return;
    }
    if (!reason.trim()) {
      setFormError('Please enter the reason for your leave.');
      return;
    }

    setSubmitting(true);
    try {
      await leaveApi.submitLeaveRequest({
        leaveType,
        isDateRange: isRange,
        startDate,
        endDate: isRange ? endDate : startDate,
        reason: reason.trim()
      });

      // Show Medium-Sized Center Modal
      setShowSuccessModal(true);
      // Reset form
      setReason('');
      setStartDate(getTodayString());
      setEndDate(getTodayString());
      setIsRange(false);
      // Refresh requests
      fetchRequests();
    } catch (err) {
      setFormError(err.message || 'Failed to submit leave request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Handle Logout ──────────────────────────────────────────────────────────
  const handleLogout = () => {
    leaveApi.employeeLogout();
    setEmployee(null);
    setMyRequests([]);
    setAuthView('login');
  };

  // ── Filtered History ───────────────────────────────────────────────────────
  const filteredHistory = useMemo(() => {
    if (historyFilter === 'All') return myRequests;
    return myRequests.filter(r => r.status === historyFilter);
  }, [myRequests, historyFilter]);

  // ===========================================================================
  // RENDER 1: AUTHENTICATION (LOGIN & SIGNUP)
  // ===========================================================================
  if (!employee) {
    return (
      <div className="login-overlay employee-portal-bg">
        <div className="employee-auth-card">
          {/* Top Switcher */}
          <div className="portal-top-bar">
            <button
              type="button"
              className="btn btn-outline portal-switch-btn"
              onClick={onSwitchToHod}
              title="Return to Administrator Login"
            >
              ← HOD Portal
            </button>
            {onToggleTheme && (
              <button
                type="button"
                className="btn btn-outline portal-theme-btn"
                onClick={onToggleTheme}
                title="Toggle Theme"
              >
                {currentTheme === 'dark' ? '🌞' : '🌙'}
              </button>
            )}
          </div>

          <div className="login-logo">📝</div>
          <h2 className="login-title">Employee Leave Portal</h2>
          <p className="login-subtitle">
            {authView === 'login'
              ? 'Sign in to manage your leave requests'
              : 'Create your academic employee profile'}
          </p>

          {/* Auth Mode Toggle Tabs */}
          <div className="auth-tab-switch">
            <button
              type="button"
              className={`auth-tab-btn ${authView === 'login' ? 'active' : ''}`}
              onClick={() => { setAuthView('login'); setLoginError(''); setSignupSuccessMsg(''); }}
            >
              Log In
            </button>
            <button
              type="button"
              className={`auth-tab-btn ${authView === 'signup' ? 'active' : ''}`}
              onClick={() => { setAuthView('signup'); setLoginError(''); setSignupSuccessMsg(''); }}
            >
              Create Account
            </button>
          </div>

          {/* ── LOGIN FORM ── */}
          {authView === 'login' ? (
            <form onSubmit={handleLoginSubmit} className="employee-auth-form">
              {loginError && (
                <div className="alert-banner error" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', fontSize: '0.85rem' }}>
                  ⚠️ {loginError}
                </div>
              )}
              {signupSuccessMsg && (
                <div className="alert-banner success" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', fontSize: '0.85rem' }}>
                  ✅ {signupSuccessMsg}
                </div>
              )}

              <div className="form-group">
                <label htmlFor="emp-identifier">Email or Employee ID</label>
                <input
                  id="emp-identifier"
                  className="text-input"
                  type="text"
                  placeholder="e.g. EMP001 or faculty@college.edu"
                  value={loginIdentifier}
                  onChange={(e) => setLoginIdentifier(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="emp-password">Password</label>
                <input
                  id="emp-password"
                  className="text-input"
                  type="password"
                  placeholder="Enter your password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary login-btn"
                disabled={loginLoading}
                style={{ marginTop: '0.5rem' }}
              >
                {loginLoading ? 'Signing In...' : 'Login'}
              </button>

              <div style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                Don&apos;t have an account?{' '}
                <button
                  type="button"
                  onClick={() => { setAuthView('signup'); setLoginError(''); }}
                  style={{ background: 'none', border: 'none', color: 'var(--primary)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
                >
                  Sign Up Here
                </button>
              </div>
            </form>
          ) : (
            /* ── SIGNUP FORM ── */
            <form onSubmit={handleSignupSubmit} className="employee-auth-form">
              {signupErrors.general && (
                <div className="alert-banner error" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', fontSize: '0.85rem' }}>
                  ⚠️ {signupErrors.general}
                </div>
              )}

              <div className="form-group">
                <label htmlFor="signup-name">Full Name <span style={{ color: 'var(--danger)' }}>*</span></label>
                <input
                  id="signup-name"
                  className="text-input"
                  type="text"
                  placeholder="e.g. Dr. Ramesh Sharma"
                  value={signupData.fullName}
                  onChange={(e) => setSignupData({ ...signupData, fullName: e.target.value })}
                />
                {signupErrors.fullName && <span className="field-error">{signupErrors.fullName}</span>}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label htmlFor="signup-email">Email <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input
                    id="signup-email"
                    className="text-input"
                    type="email"
                    placeholder="name@college.edu"
                    value={signupData.email}
                    onChange={(e) => setSignupData({ ...signupData, email: e.target.value })}
                  />
                  {signupErrors.email && <span className="field-error">{signupErrors.email}</span>}
                </div>
                <div className="form-group">
                  <label htmlFor="signup-empid">Employee ID <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input
                    id="signup-empid"
                    className="text-input"
                    type="text"
                    placeholder="e.g. EMP102"
                    value={signupData.employeeId}
                    onChange={(e) => setSignupData({ ...signupData, employeeId: e.target.value })}
                  />
                  {signupErrors.employeeId && <span className="field-error">{signupErrors.employeeId}</span>}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label htmlFor="signup-role">Role <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <select
                    id="signup-role"
                    className="text-input"
                    value={signupData.role}
                    onChange={(e) => setSignupData({ ...signupData, role: e.target.value })}
                  >
                    <option value="Assistant Professor">Assistant Professor</option>
                    <option value="Associate Professor">Associate Professor</option>
                    <option value="Professor">Professor</option>
                    <option value="Lab Instructor">Lab Instructor</option>
                    <option value="Teaching Assistant">Teaching Assistant</option>
                    <option value="Lecturer">Lecturer</option>
                  </select>
                  {signupErrors.role && <span className="field-error">{signupErrors.role}</span>}
                </div>
                <div className="form-group">
                  <label htmlFor="signup-subjects">Subject(s) Taught <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input
                    id="signup-subjects"
                    className="text-input"
                    type="text"
                    placeholder="e.g. Python, DBMS, OS"
                    value={signupData.subjects}
                    onChange={(e) => setSignupData({ ...signupData, subjects: e.target.value })}
                  />
                  {signupErrors.subjects && <span className="field-error">{signupErrors.subjects}</span>}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label htmlFor="signup-pass">Password <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input
                    id="signup-pass"
                    className="text-input"
                    type="password"
                    placeholder="Min 6 characters"
                    value={signupData.password}
                    onChange={(e) => setSignupData({ ...signupData, password: e.target.value })}
                  />
                  {signupErrors.password && <span className="field-error">{signupErrors.password}</span>}
                </div>
                <div className="form-group">
                  <label htmlFor="signup-confirmpass">Confirm Password <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input
                    id="signup-confirmpass"
                    className="text-input"
                    type="password"
                    placeholder="Re-enter password"
                    value={signupData.confirmPassword}
                    onChange={(e) => setSignupData({ ...signupData, confirmPassword: e.target.value })}
                  />
                  {signupErrors.confirmPassword && <span className="field-error">{signupErrors.confirmPassword}</span>}
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary login-btn"
                disabled={signupLoading}
                style={{ marginTop: '0.5rem' }}
              >
                {signupLoading ? 'Creating Account...' : 'Create Account / Sign Up'}
              </button>

              <div style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                Already registered?{' '}
                <button
                  type="button"
                  onClick={() => { setAuthView('login'); setSignupErrors({}); }}
                  style={{ background: 'none', border: 'none', color: 'var(--primary)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
                >
                  Log In Here
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  // ===========================================================================
  // RENDER 2: EMPLOYEE LEAVE DASHBOARD (LOGGED IN)
  // ===========================================================================
  const pendingCount = myRequests.filter(r => r.status === 'Pending').length;
  const approvedCount = myRequests.filter(r => r.status === 'Approved').length;

  return (
    <div className="employee-dashboard-layout">
      {/* ── HEADER & PROFILE SUMMARY ── */}
      <header className="employee-navbar">
        <div className="employee-nav-left">
          <div className="employee-logo-mark">🎓</div>
          <div>
            <h1 className="employee-app-title">Academic ERP — Employee Leave Portal</h1>
            <div className="employee-profile-pills">
              <span className="profile-badge-pill">👤 {employee.fullName}</span>
              <span className="profile-badge-pill">🆔 {employee.employeeId}</span>
              <span className="profile-badge-pill">🏷️ {employee.role}</span>
              <span className="profile-badge-pill">📚 {employee.subjects}</span>
            </div>
          </div>
        </div>

        <div className="employee-nav-actions">
          {onToggleTheme && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={onToggleTheme}
              title="Toggle Theme"
              style={{ fontSize: '0.85rem', padding: '0.45rem 0.75rem' }}
            >
              {currentTheme === 'dark' ? '🌞 Light' : '🌙 Dark'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-outline"
            onClick={onSwitchToHod}
            title="Switch to HOD Portal"
            style={{ fontSize: '0.85rem', padding: '0.45rem 0.75rem' }}
          >
            🏛️ HOD Portal
          </button>
          <button
            type="button"
            className="btn btn-outline logout-btn-styled"
            onClick={handleLogout}
            style={{ fontSize: '0.85rem', padding: '0.45rem 0.85rem', color: 'var(--danger)' }}
          >
            🚪 Log Out
          </button>
        </div>
      </header>

      {/* ── NAVIGATION TABS ── */}
      <div className="employee-tabs-container">
        <button
          type="button"
          className={`employee-tab-btn ${activeTab === 'apply' ? 'active' : ''}`}
          onClick={() => setActiveTab('apply')}
        >
          ✍️ Apply for Leave
        </button>
        <button
          type="button"
          className={`employee-tab-btn ${activeTab === 'requests' ? 'active' : ''}`}
          onClick={() => setActiveTab('requests')}
        >
          📋 My Leave Requests
          {pendingCount > 0 && <span className="tab-counter-badge">{pendingCount}</span>}
        </button>
        <button
          type="button"
          className={`employee-tab-btn ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          📜 Leave History
        </button>
      </div>

      {/* ── MAIN CONTENT CONTAINER ── */}
      <main className="employee-content-area">
        {/* =================================================================== */}
        {/* TAB 1: APPLY FOR LEAVE */}
        {/* =================================================================== */}
        {activeTab === 'apply' && (
          <div className="leave-card apply-leave-card">
            <div className="leave-card-header">
              <h2 className="leave-card-title">📝 Leave Application Form</h2>
              <p className="leave-card-subtitle">
                Please fill in the leave period and reason below. Your profile details are automatically linked.
              </p>
            </div>

            {formError && (
              <div className="alert-banner error" style={{ marginBottom: '1.25rem', padding: '0.75rem 1rem' }}>
                ⚠️ {formError}
              </div>
            )}

            <form onSubmit={handleLeaveSubmit} className="leave-form-grid">
              {/* Auto-populated Employee Details */}
              <div className="form-group">
                <label>Employee Name</label>
                <input
                  type="text"
                  className="text-input readonly-input"
                  value={employee.fullName}
                  disabled
                  readOnly
                />
                <span className="field-hint">Automatically populated from your account</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                <div className="form-group">
                  <label>Role</label>
                  <input
                    type="text"
                    className="text-input readonly-input"
                    value={employee.role}
                    disabled
                    readOnly
                  />
                </div>
                <div className="form-group">
                  <label>Subject / Subjects Taught</label>
                  <input
                    type="text"
                    className="text-input readonly-input"
                    value={employee.subjects}
                    disabled
                    readOnly
                  />
                </div>
              </div>

              {/* Leave Type */}
              <div className="form-group">
                <label htmlFor="leave-type">Leave Type <span style={{ color: 'var(--danger)' }}>*</span></label>
                <select
                  id="leave-type"
                  className="text-input"
                  value={leaveType}
                  onChange={(e) => setLeaveType(e.target.value)}
                >
                  <option value="Casual Leave">Casual Leave</option>
                  <option value="Sick Leave">Sick Leave</option>
                </select>
              </div>

              {/* Date Selection Mode */}
              <div className="form-group">
                <label>Leave Duration Mode</label>
                <div className="date-mode-selector">
                  <button
                    type="button"
                    className={`date-mode-btn ${!isRange ? 'active' : ''}`}
                    onClick={() => { setIsRange(false); setEndDate(startDate); }}
                  >
                    📅 Single Day
                  </button>
                  <button
                    type="button"
                    className={`date-mode-btn ${isRange ? 'active' : ''}`}
                    onClick={() => { setIsRange(true); }}
                  >
                    📆 Date Range
                  </button>
                </div>
              </div>

              {/* Date Pickers */}
              {!isRange ? (
                <div className="form-group">
                  <label htmlFor="single-date">Leave Date <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input
                    id="single-date"
                    type="date"
                    className="date-input"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      setEndDate(e.target.value);
                    }}
                    required
                  />
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label htmlFor="range-start">Start Date <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input
                      id="range-start"
                      type="date"
                      className="date-input"
                      value={startDate}
                      onChange={(e) => {
                        setStartDate(e.target.value);
                        if (endDate < e.target.value) setEndDate(e.target.value);
                      }}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="range-end">End Date <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input
                      id="range-end"
                      type="date"
                      className="date-input"
                      min={startDate}
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      required
                    />
                  </div>
                </div>
              )}

              {/* Calculated Days & Date Preview Card */}
              <div className="calculated-days-preview">
                <div className="preview-item">
                  <span className="preview-label">Selected Leave Date:</span>
                  <span className="preview-value date-highlight">{selectedDateLabel || 'None selected'}</span>
                </div>
                <div className="preview-item">
                  <span className="preview-label">Total Leave Duration:</span>
                  <span className="preview-value days-badge">
                    {calculatedDays} {calculatedDays === 1 ? 'Day' : 'Days'}
                  </span>
                </div>
              </div>

              {/* Reason */}
              <div className="form-group">
                <label htmlFor="leave-reason">Reason for Leave <span style={{ color: 'var(--danger)' }}>*</span></label>
                <textarea
                  id="leave-reason"
                  className="text-input"
                  rows={4}
                  placeholder="Please describe the reason for your leave request..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  style={{ resize: 'vertical' }}
                  required
                />
              </div>

              {/* Submit Button */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
                <button
                  type="submit"
                  className="btn btn-primary submit-leave-btn"
                  disabled={submitting}
                >
                  {submitting ? 'Submitting...' : 'Submit Leave Request'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 2: MY LEAVE REQUESTS */}
        {/* =================================================================== */}
        {activeTab === 'requests' && (
          <div className="leave-card">
            <div className="leave-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <h2 className="leave-card-title">📋 My Leave Requests</h2>
                <p className="leave-card-subtitle">
                  Live status of your submitted leave requests. Only visible to you and the HOD.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-outline"
                onClick={fetchRequests}
                disabled={requestsLoading}
                style={{ fontSize: '0.85rem' }}
              >
                🔄 {requestsLoading ? 'Refreshing...' : 'Refresh Status'}
              </button>
            </div>

            {myRequests.length === 0 ? (
              <div className="empty-state-box">
                <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📄</div>
                <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-main)' }}>No Leave Requests Found</div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '0.35rem', maxWidth: '380px' }}>
                  You have not submitted any leave requests yet. Click &ldquo;Apply for Leave&rdquo; to submit one.
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setActiveTab('apply')}
                  style={{ marginTop: '1rem', fontSize: '0.85rem' }}
                >
                  Apply for Leave
                </button>
              </div>
            ) : (
              <div className="requests-grid">
                {myRequests.map((req) => (
                  <div key={req._id} className="request-card-item">
                    <div className="req-card-top">
                      <span className={`badge ${req.leaveType === 'Sick Leave' ? 'badge-sick' : 'badge-casual'}`}>
                        {req.leaveType}
                      </span>
                      {/* Status indicator */}
                      {req.status === 'Pending' && (
                        <span className="status-pill pending">🟡 Pending</span>
                      )}
                      {req.status === 'Approved' && (
                        <span className="status-pill approved">🟢 Approved</span>
                      )}
                      {req.status === 'Rejected' && (
                        <span className="status-pill rejected">🔴 Rejected</span>
                      )}
                    </div>

                    <div className="req-date-row">
                      <span className="req-date-text">📅 {req.formattedDate}</span>
                      <span className="req-days-text">({req.numberOfDays} {req.numberOfDays === 1 ? 'Day' : 'Days'})</span>
                    </div>

                    <div className="req-reason-box">
                      <strong>Reason:</strong> {req.reason}
                    </div>

                    {req.status === 'Rejected' && req.rejectionReason && (
                      <div className="rejection-reason-notice">
                        <strong>Rejection Reason:</strong> {req.rejectionReason}
                      </div>
                    )}

                    <div className="req-card-footer">
                      <span className="applied-date-text">
                        Applied on: {formatReadableDate(req.appliedAt)}
                      </span>

                      {/* View Letter Button - ONLY clickable action for Approved status */}
                      {req.status === 'Approved' && (
                        <button
                          type="button"
                          className="btn btn-primary view-letter-btn"
                          onClick={() => setActiveLetterRequest(req)}
                        >
                          📄 View Letter
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 3: LEAVE HISTORY */}
        {/* =================================================================== */}
        {activeTab === 'history' && (
          <div className="leave-card">
            <div className="leave-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <h2 className="leave-card-title">📜 Leave History</h2>
                <p className="leave-card-subtitle">
                  Historical archive of all your past leave requests and approvals.
                </p>
              </div>

              {/* Filter Pills */}
              <div className="filter-pills-row">
                {['All', 'Approved', 'Rejected', 'Pending'].map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`filter-pill ${historyFilter === f ? 'active' : ''}`}
                    onClick={() => setHistoryFilter(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {filteredHistory.length === 0 ? (
              <div className="empty-state-box">
                <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📂</div>
                <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-main)' }}>No Records in &ldquo;{historyFilter}&rdquo;</div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '0.35rem' }}>
                  No leave requests match the selected filter.
                </p>
              </div>
            ) : (
              <div className="history-table-wrapper">
                <table className="custom-data-table">
                  <thead>
                    <tr>
                      <th>Leave Type</th>
                      <th>Dates</th>
                      <th>Days</th>
                      <th>Reason</th>
                      <th>Applied Date</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistory.map((req) => (
                      <tr key={req._id}>
                        <td>
                          <span className={`badge ${req.leaveType === 'Sick Leave' ? 'badge-sick' : 'badge-casual'}`}>
                            {req.leaveType}
                          </span>
                        </td>
                        <td style={{ fontWeight: 600 }}>{req.formattedDate}</td>
                        <td>{req.numberOfDays}d</td>
                        <td style={{ maxWidth: '240px' }} title={req.reason}>
                          <div style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                            {req.reason}
                          </div>
                          {req.status === 'Rejected' && req.rejectionReason && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: '0.2rem' }}>
                              Reason: {req.rejectionReason}
                            </div>
                          )}
                        </td>
                        <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                          {formatReadableDate(req.appliedAt)}
                        </td>
                        <td>
                          {req.status === 'Pending' && <span className="status-pill pending">Pending</span>}
                          {req.status === 'Approved' && <span className="status-pill approved">Approved</span>}
                          {req.status === 'Rejected' && <span className="status-pill rejected">Rejected</span>}
                        </td>
                        <td>
                          {req.status === 'Approved' ? (
                            <button
                              type="button"
                              className="btn btn-outline"
                              style={{ fontSize: '0.78rem', padding: '0.3rem 0.65rem' }}
                              onClick={() => setActiveLetterRequest(req)}
                            >
                              View Letter
                            </button>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ===================================================================== */}
      {/* FEATURE 5: SUCCESS MODAL POPUP (MEDIUM-SIZED IN CENTER) */}
      {/* ===================================================================== */}
      {showSuccessModal && (
        <div className="modal-backdrop" onClick={() => setShowSuccessModal(false)}>
          <div
            className="modal-content medium-success-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="modal-close-btn"
              onClick={() => setShowSuccessModal(false)}
              aria-label="Close"
            >
              ✕
            </button>

            <div className="success-modal-body">
              <div className="success-icon-badge">✅</div>
              <h2 className="success-title">Successfully Applied</h2>
              <p className="success-subtitle">
                Your leave request has been submitted successfully.
              </p>
              <p className="success-detail-text">
                Your request has been forwarded directly to the HOD for review. You can track its status in the &ldquo;My Leave Requests&rdquo; tab.
              </p>

              <button
                type="button"
                className="btn btn-primary success-modal-close-btn"
                onClick={() => setShowSuccessModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* FEATURE 7: APPROVED LEAVE LETTER MODAL */}
      {/* ===================================================================== */}
      {activeLetterRequest && (
        <div className="modal-backdrop" onClick={() => setActiveLetterRequest(null)}>
          <div
            className="modal-content leave-letter-modal"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="modal-header letter-modal-header no-print">
              <h3 style={{ fontSize: '1.05rem', fontWeight: 800 }}>📄 Official Leave Approval Letter</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-primary print-letter-btn"
                  onClick={() => window.print()}
                >
                  🖨️ Print Letter
                </button>
                <button
                  type="button"
                  className="modal-close-btn"
                  onClick={() => setActiveLetterRequest(null)}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Official Letter Content Container */}
            <div className="official-letter-sheet" id="printable-leave-letter">
              <div className="letter-header-section">
                <div className="letter-crest">🎓</div>
                <h2 className="letter-doc-title">LEAVE APPROVAL LETTER</h2>
                <div className="letter-meta-date">
                  <strong>Date:</strong> {formatReadableDate(activeLetterRequest.approvedAt || activeLetterRequest.appliedAt)}
                </div>
              </div>

              <div className="letter-body-section">
                <p className="letter-salutation">
                  Dear <strong>{activeLetterRequest.employeeName || employee.fullName}</strong>,
                </p>

                <p className="letter-paragraph">
                  Your request for <strong>{activeLetterRequest.leaveType}</strong> for the period:
                </p>

                <div className="letter-highlight-period">
                  <strong>{activeLetterRequest.formattedDate}</strong> ({activeLetterRequest.numberOfDays} {activeLetterRequest.numberOfDays === 1 ? 'Day' : 'Days'})
                </div>

                <p className="letter-paragraph">
                  has been reviewed and approved.
                </p>

                <p className="letter-paragraph">
                  We acknowledge your leave request based on the reason provided:
                </p>

                <div className="letter-quote-reason">
                  <strong>Reason:</strong><br />
                  {activeLetterRequest.reason}
                </div>

                <p className="letter-paragraph">
                  Your leave has been officially approved.
                </p>

                <p className="letter-paragraph">
                  Please ensure that any necessary academic or instructional responsibilities are communicated appropriately before your leave period.
                </p>

                <p className="letter-paragraph">
                  We wish you good health and hope you have a smooth leave period.
                </p>

                <p className="letter-paragraph">
                  Thank you.
                </p>
              </div>

              <div className="letter-signature-section">
                <div className="signature-line">
                  <div className="signature-role">Approved By</div>
                  <div className="signature-name">Manideep (COS)</div>
                  <div className="signature-seal">Department of Academic Administration</div>
                </div>
              </div>
            </div>

            <div className="modal-footer no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setActiveLetterRequest(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
