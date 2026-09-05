// src/components/HodLeaveManagement.jsx
// HOD Leave Request Management module:
// - Two Tabs: Requests (Pending) and History (Approved / Rejected)
// - Small Confirmation Modals for Approval and Rejection
// - History filtering (All, Approved, Rejected)
// - View Letter capability for approved requests

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import * as leaveApi from '../leaveApi.js';

// Format ISO date to readable date: e.g. "05 Sep 2026"
function formatReadableDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return String(isoStr);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const day = String(d.getDate()).padStart(2, '0');
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

export default function HodLeaveManagement({ onPendingCountChange }) {
  const [activeTab, setActiveTab] = useState('requests'); // 'requests' | 'history'
  const [allRequests, setAllRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successBanner, setSuccessBanner] = useState('');

  // History filter: 'All' | 'Approved' | 'Rejected'
  const [historyFilter, setHistoryFilter] = useState('All');

  // Confirmation Modals State
  const [approveConfirmTarget, setApproveConfirmTarget] = useState(null);
  const [rejectConfirmTarget, setRejectConfirmTarget] = useState(null);
  const [rejectionReasonInput, setRejectionReasonInput] = useState('');
  const [rejectError, setRejectError] = useState('');

  // Letter View Modal (for Approved requests in HOD view)
  const [viewLetterTarget, setViewLetterTarget] = useState(null);

  // Fetch all requests
  const loadRequests = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const data = await leaveApi.getHodLeaveRequests();
      const list = Array.isArray(data) ? data : [];
      setAllRequests(list);
      const pendingCount = list.filter(r => r.status === 'Pending').length;
      if (onPendingCountChange) {
        onPendingCountChange(pendingCount);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to load leave requests.');
    } finally {
      setLoading(false);
    }
  }, [onPendingCountChange]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  // Separate Pending Requests vs History Requests
  const pendingRequests = useMemo(() => {
    return allRequests.filter(r => r.status === 'Pending');
  }, [allRequests]);

  const historyRequests = useMemo(() => {
    const list = allRequests.filter(r => r.status !== 'Pending');
    if (historyFilter === 'All') return list;
    return list.filter(r => r.status === historyFilter);
  }, [allRequests, historyFilter]);

  // ── Handle Approve ─────────────────────────────────────────────────────────
  const handleConfirmApproval = async () => {
    if (!approveConfirmTarget) return;
    setActionLoading(true);
    setErrorMsg('');
    try {
      await leaveApi.approveLeaveRequest(approveConfirmTarget._id);
      setSuccessBanner(`Leave request for ${approveConfirmTarget.employeeName} approved successfully.`);
      setApproveConfirmTarget(null);
      await loadRequests();
      // Auto dismiss success banner after 4 seconds
      setTimeout(() => setSuccessBanner(''), 4000);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to approve leave request.');
    } finally {
      setActionLoading(false);
    }
  };

  // ── Handle Reject ──────────────────────────────────────────────────────────
  const handleConfirmRejection = async () => {
    if (!rejectConfirmTarget) return;
    if (!rejectionReasonInput.trim()) {
      setRejectError('Please provide a reason for rejecting this leave request.');
      return;
    }

    setActionLoading(true);
    setRejectError('');
    try {
      await leaveApi.rejectLeaveRequest(rejectConfirmTarget._id, rejectionReasonInput.trim());
      setSuccessBanner(`Leave request for ${rejectConfirmTarget.employeeName} rejected.`);
      setRejectConfirmTarget(null);
      setRejectionReasonInput('');
      await loadRequests();
      setTimeout(() => setSuccessBanner(''), 4000);
    } catch (err) {
      setRejectError(err.message || 'Failed to reject leave request.');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="hod-leaves-wrapper">
      {/* ── TOP HEADER & SUMMARY STATS ── */}
      <div className="hod-leaves-header">
        <div>
          <h2 className="section-title">📋 Leave Request Management</h2>
          <p className="section-subtitle">
            Review and process faculty &amp; staff leave requests with instant live synchronization.
          </p>
        </div>

        <button
          type="button"
          className="btn btn-outline"
          onClick={loadRequests}
          disabled={loading}
          style={{ fontSize: '0.85rem' }}
        >
          🔄 {loading ? 'Refreshing...' : 'Refresh Requests'}
        </button>
      </div>

      {/* Notifications */}
      {successBanner && (
        <div className="alert-banner success" style={{ marginBottom: '1rem', padding: '0.75rem 1rem' }}>
          ✅ {successBanner}
        </div>
      )}
      {errorMsg && (
        <div className="alert-banner error" style={{ marginBottom: '1rem', padding: '0.75rem 1rem' }}>
          ⚠️ {errorMsg}
        </div>
      )}

      {/* ── TABS: REQUESTS VS HISTORY ── */}
      <div className="hod-leaves-tabs">
        <button
          type="button"
          className={`hod-leave-tab-btn ${activeTab === 'requests' ? 'active' : ''}`}
          onClick={() => setActiveTab('requests')}
        >
          ⏳ Requests (Pending)
          {pendingRequests.length > 0 && (
            <span className="hod-tab-counter-badge">{pendingRequests.length}</span>
          )}
        </button>

        <button
          type="button"
          className={`hod-leave-tab-btn ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          📜 History
        </button>
      </div>

      {/* ===================================================================== */}
      {/* TAB 1: PENDING REQUESTS */}
      {/* ===================================================================== */}
      {activeTab === 'requests' && (
        <div className="hod-tab-content">
          {pendingRequests.length === 0 ? (
            <div className="empty-state-box">
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>✨</div>
              <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-main)' }}>
                No Pending Leave Requests
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '0.35rem', maxWidth: '380px' }}>
                All faculty leave requests have been reviewed and processed. New requests submitted via the Employee Portal will appear here in real-time.
              </p>
            </div>
          ) : (
            <div className="hod-requests-grid">
              {pendingRequests.map((req) => (
                <div key={req._id} className="hod-request-card">
                  {/* Card Header: Employee info & Leave type */}
                  <div className="hod-card-header">
                    <div>
                      <h3 className="emp-name-title">{req.employeeName}</h3>
                      <div className="emp-meta-row">
                        <span className="emp-meta-pill">🆔 {req.employeeId}</span>
                        <span className="emp-meta-pill">🏷️ {req.role}</span>
                        <span className="emp-meta-pill">📚 {req.subjects}</span>
                      </div>
                    </div>
                    <span className={`badge ${req.leaveType === 'Sick Leave' ? 'badge-sick' : 'badge-casual'}`}>
                      {req.leaveType}
                    </span>
                  </div>

                  {/* Card Details: Dates, Days, Reason */}
                  <div className="hod-card-details">
                    <div className="detail-row">
                      <span className="detail-label">Leave Period:</span>
                      <span className="detail-value highlight-date">
                        📅 {req.formattedDate}
                        <strong style={{ marginLeft: '0.4rem', color: 'var(--primary)' }}>
                          ({req.numberOfDays} {req.numberOfDays === 1 ? 'Day' : 'Days'})
                        </strong>
                      </span>
                    </div>

                    <div className="detail-row">
                      <span className="detail-label">Reason:</span>
                      <p className="detail-reason-box">{req.reason}</p>
                    </div>

                    <div className="detail-row" style={{ marginTop: '0.3rem' }}>
                      <span className="detail-label">Applied On:</span>
                      <span className="detail-value" style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                        {formatReadableDate(req.appliedAt)}
                      </span>
                    </div>
                  </div>

                  {/* Card Actions: Approve & Reject */}
                  <div className="hod-card-actions">
                    <button
                      type="button"
                      className="btn btn-primary approve-btn"
                      onClick={() => setApproveConfirmTarget(req)}
                    >
                      🟢 Approve
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline reject-btn"
                      onClick={() => {
                        setRejectConfirmTarget(req);
                        setRejectionReasonInput('');
                        setRejectError('');
                      }}
                    >
                      🔴 Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: HISTORY (APPROVED & REJECTED) */}
      {/* ===================================================================== */}
      {activeTab === 'history' && (
        <div className="hod-tab-content">
          {/* Filters */}
          <div className="history-filter-header">
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-muted)' }}>Filter History:</span>
            <div className="filter-pills-row">
              {['All', 'Approved', 'Rejected'].map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className={`filter-pill ${historyFilter === filter ? 'active' : ''}`}
                  onClick={() => setHistoryFilter(filter)}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>

          {historyRequests.length === 0 ? (
            <div className="empty-state-box">
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📂</div>
              <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-main)' }}>
                No History Found in &ldquo;{historyFilter}&rdquo;
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '0.35rem' }}>
                There are currently no leave records under the selected filter.
              </p>
            </div>
          ) : (
            <div className="hod-history-table-wrapper">
              <table className="custom-data-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Role &amp; Subject</th>
                    <th>Type</th>
                    <th>Dates</th>
                    <th>Days</th>
                    <th>Reason</th>
                    <th>Applied</th>
                    <th>Action Date</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRequests.map((req) => (
                    <tr key={req._id}>
                      <td>
                        <strong>{req.employeeName}</strong>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{req.employeeId}</div>
                      </td>
                      <td>
                        <div style={{ fontSize: '0.82rem' }}>{req.role}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{req.subjects}</div>
                      </td>
                      <td>
                        <span className={`badge ${req.leaveType === 'Sick Leave' ? 'badge-sick' : 'badge-casual'}`}>
                          {req.leaveType}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600 }}>{req.formattedDate}</td>
                      <td>{req.numberOfDays}d</td>
                      <td style={{ maxWidth: '220px' }}>
                        <div style={{ fontSize: '0.82rem' }}>{req.reason}</div>
                        {req.status === 'Rejected' && req.rejectionReason && (
                          <div className="rejection-table-reason">
                            <strong>Reason:</strong> {req.rejectionReason}
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {formatReadableDate(req.appliedAt)}
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {formatReadableDate(req.approvedAt || req.rejectedAt)}
                      </td>
                      <td>
                        {req.status === 'Approved' && (
                          <span className="status-pill approved">🟢 Approved</span>
                        )}
                        {req.status === 'Rejected' && (
                          <span className="status-pill rejected">🔴 Rejected</span>
                        )}
                      </td>
                      <td>
                        {req.status === 'Approved' ? (
                          <button
                            type="button"
                            className="btn btn-outline"
                            style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                            onClick={() => setViewLetterTarget(req)}
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

      {/* ===================================================================== */}
      {/* FEATURE 10: APPROVE CONFIRMATION MODAL (SMALL IN CENTER) */}
      {/* ===================================================================== */}
      {approveConfirmTarget && (
        <div className="modal-backdrop" onClick={() => !actionLoading && setApproveConfirmTarget(null)}>
          <div
            className="modal-content small-confirm-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 style={{ fontSize: '1.05rem', fontWeight: 800 }}>Confirm Leave Approval</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setApproveConfirmTarget(null)}
                disabled={actionLoading}
              >
                ✕
              </button>
            </div>

            <div className="modal-body" style={{ padding: '1rem 0' }}>
              <p style={{ fontSize: '0.95rem', color: 'var(--text-main)', marginBottom: '0.5rem', lineHeight: 1.5 }}>
                Would you like to proceed with approving this leave request?
              </p>
              <div className="confirm-summary-pill">
                <strong>{approveConfirmTarget.employeeName}</strong> &bull; {approveConfirmTarget.leaveType} ({approveConfirmTarget.formattedDate})
              </div>
            </div>

            <div className="modal-actions-row">
              <button
                type="button"
                className="btn btn-outline"
                style={{ flex: 1 }}
                onClick={() => setApproveConfirmTarget(null)}
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary approve-btn"
                style={{ flex: 1 }}
                onClick={handleConfirmApproval}
                disabled={actionLoading}
              >
                {actionLoading ? 'Approving...' : 'Confirm Approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* FEATURE 11: REJECT CONFIRMATION MODAL (SMALL IN CENTER WITH REASON) */}
      {/* ===================================================================== */}
      {rejectConfirmTarget && (
        <div className="modal-backdrop" onClick={() => !actionLoading && setRejectConfirmTarget(null)}>
          <div
            className="modal-content small-confirm-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--danger)' }}>Confirm Leave Rejection</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setRejectConfirmTarget(null)}
                disabled={actionLoading}
              >
                ✕
              </button>
            </div>

            <div className="modal-body" style={{ padding: '0.75rem 0' }}>
              <div className="confirm-summary-pill" style={{ marginBottom: '1rem' }}>
                <strong>{rejectConfirmTarget.employeeName}</strong> &bull; {rejectConfirmTarget.leaveType} ({rejectConfirmTarget.formattedDate})
              </div>

              {rejectError && (
                <div className="alert-banner error" style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', fontSize: '0.82rem' }}>
                  ⚠️ {rejectError}
                </div>
              )}

              <div className="form-group">
                <label htmlFor="rejection-reason-input" style={{ fontWeight: 600 }}>
                  Rejection Reason <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <textarea
                  id="rejection-reason-input"
                  className="text-input"
                  rows={3}
                  placeholder="Enter the reason for rejecting this leave request..."
                  value={rejectionReasonInput}
                  onChange={(e) => setRejectionReasonInput(e.target.value)}
                  style={{ resize: 'vertical' }}
                  required
                />
              </div>

              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                Would you like to proceed with rejecting this leave request?
              </p>
            </div>

            <div className="modal-actions-row">
              <button
                type="button"
                className="btn btn-outline"
                style={{ flex: 1 }}
                onClick={() => setRejectConfirmTarget(null)}
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary reject-confirm-btn"
                style={{ flex: 1 }}
                onClick={handleConfirmRejection}
                disabled={actionLoading}
              >
                {actionLoading ? 'Rejecting...' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* VIEW LETTER MODAL (HOD VIEW) */}
      {/* ===================================================================== */}
      {viewLetterTarget && (
        <div className="modal-backdrop" onClick={() => setViewLetterTarget(null)}>
          <div className="modal-content leave-letter-modal" onClick={(e) => e.stopPropagation()}>
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
                  onClick={() => setViewLetterTarget(null)}
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="official-letter-sheet" id="hod-printable-leave-letter">
              <div className="letter-header-section">
                <div className="letter-crest">🎓</div>
                <h2 className="letter-doc-title">LEAVE APPROVAL LETTER</h2>
                <div className="letter-meta-date">
                  <strong>Date:</strong> {formatReadableDate(viewLetterTarget.approvedAt || viewLetterTarget.appliedAt)}
                </div>
              </div>

              <div className="letter-body-section">
                <p className="letter-salutation">
                  Dear <strong>{viewLetterTarget.employeeName}</strong>,
                </p>

                <p className="letter-paragraph">
                  Your request for <strong>{viewLetterTarget.leaveType}</strong> for the period:
                </p>

                <div className="letter-highlight-period">
                  <strong>{viewLetterTarget.formattedDate}</strong> ({viewLetterTarget.numberOfDays} {viewLetterTarget.numberOfDays === 1 ? 'Day' : 'Days'})
                </div>

                <p className="letter-paragraph">
                  has been reviewed and approved.
                </p>

                <p className="letter-paragraph">
                  We acknowledge your leave request based on the reason provided:
                </p>

                <div className="letter-quote-reason">
                  <strong>Reason:</strong><br />
                  {viewLetterTarget.reason}
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
                onClick={() => setViewLetterTarget(null)}
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
