import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as api from './api.js';

// =====================================================================
// NOTES & REMINDERS — REBUILT HELPER FUNCTIONS
// =====================================================================

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function generateId() {
  return `rem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// Format YYYY-MM-DD + HH:MM -> "02 Sep 2026 • 10:30 AM"
function formatReminderDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return `${dateStr} ${timeStr}`;
  const day = parts[2];
  const monthIdx = parseInt(parts[1], 10) - 1;
  const year = parts[0];
  const [hh, mm] = timeStr.split(':');
  let h = parseInt(hh, 10) || 0;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${day} ${MONTHS_SHORT[monthIdx] || ''} ${year} • ${String(h).padStart(2,'0')}:${mm || '00'} ${ampm}`;
}

// Format HH:MM -> "10:30 AM" safely
function formatTime12h(timeStr) {
  if (!timeStr) return '';
  const [hh, mm] = timeStr.split(':');
  let h = parseInt(hh, 10) || 0;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${String(h).padStart(2, '0')}:${mm || '00'} ${ampm}`;
}

// Reliable notification dispatcher across mobile (Android Chrome / iOS PWA) and desktop
async function showAppNotification(title, body, tag = 'hod-reminder') {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') {
    return false;
  }
  const options = {
    body: body || 'Scheduled reminder is due now.',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag,
    renotify: true,
    data: '/',
    vibrate: [200, 100, 200, 100, 200]
  };

  // 1. Try Service Worker (standard requirement on Android/iOS PWA)
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg && reg.showNotification) {
        await reg.showNotification(title, options);
        return true;
      }
    } catch (swErr) {
      console.warn('SW notification fallback:', swErr);
    }

    // Try posting message to active Service Worker controller
    try {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'SHOW_NOTIFICATION',
          title,
          options
        });
        return true;
      }
    } catch (msgErr) {
      console.warn('SW message fallback:', msgErr);
    }
  }

  // 2. Fallback for Desktop browsers that support the constructor
  try {
    new Notification(title, options);
    return true;
  } catch (e) {
    console.warn('Desktop constructor bypassed:', e);
  }
  return false;
}

// Returns overdue string like "2h overdue" or null
function getOverdue(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const target = new Date(`${dateStr}T${timeStr}:00`);
  const now = new Date();
  if (now <= target) return null;
  const diffMs = now - target;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays > 0) return `${diffDays}d overdue`;
  if (diffHours > 0) return `${diffHours}h overdue`;
  if (diffMins > 0) return `${diffMins}m overdue`;
  return 'Due now';
}

// Returns true ONLY when the scheduled date and time has arrived or passed (Asia/Kolkata / Local)
function isDue(dateStr, timeStr) {
  if (!dateStr || !timeStr) return false;
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
  const currentDay = String(now.getDate()).padStart(2, '0');
  const currentDateStr = `${currentYear}-${currentMonth}-${currentDay}`;

  const currentHours = String(now.getHours()).padStart(2, '0');
  const currentMinutes = String(now.getMinutes()).padStart(2, '0');
  const currentTimeStr = `${currentHours}:${currentMinutes}`;

  if (currentDateStr > dateStr) return true;
  if (currentDateStr === dateStr && currentTimeStr >= timeStr) return true;
  return false;
}

// Today's date in YYYY-MM-DD
function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Priority badge class
function priorityBadgeClass(p) {
  if (p === 'High') return 'badge-priority-high';
  if (p === 'Medium') return 'badge-priority-medium';
  return 'badge-priority-low';
}

function priorityIcon(p) {
  if (p === 'High') return '🔴';
  if (p === 'Medium') return '🟡';
  return '🔵';
}

// Centralized configuration for Attention Required threshold calculations
const ATTENTION_CONFIG = {
  LOW_STUDENT_ATTENDANCE_THRESHOLD: 30, // % overall student attendance (under 30% triggers High Priority)
  LOW_SECTION_ATTENDANCE_THRESHOLD: 30,   // % section attendance (under 30% triggers High Priority)
  SECTION_COMPARISON_THRESHOLD: 10        // % points difference below dept average
};

// Default empty reminder form
function emptyForm() {
  const today = todayDateStr();
  return {
    title: '',
    description: '',
    date: today,
    time: '09:00',
    priority: 'Medium',
    dashboardNotification: true,
    pushNotification: true
  };
}



// Helper function to parse CSV lines safely, handling commas inside quotes
function parseCSV(text) {
  const result = [];
  const lines = text.split(/\r?\n/);
  for (let line of lines) {
    if (!line.trim()) continue;
    const row = [];
    let insideQuote = false;
    let entry = '';
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        insideQuote = !insideQuote;
      } else if (char === ',' && !insideQuote) {
        row.push(entry.trim());
        entry = '';
      } else {
        entry += char;
      }
    }
    row.push(entry.trim());
    result.push(row);
  }
  return result;
}

// Month name map for MRV date parsing
const MONTH_MAP = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

// Robust Date Normalization supporting DD-MMM-YYYY, DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD
function normalizeSheetDate(dateStr) {
  if (!dateStr) return '';
  const s = dateStr.trim().replace(/\//g, '-');

  // DD-MMM-YYYY (e.g. 11-Jun-2026, 11-Aug-2026)
  const m1 = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m1) {
    const day = m1[1].padStart(2, '0');
    const mon = MONTH_MAP[m1[2].toLowerCase()] || '01';
    const yr = m1[3];
    return `${day}-${mon}-${yr}`;
  }

  // YYYY-MM-DD (e.g. 2026-08-11)
  const m2 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m2) {
    return `${m2[3].padStart(2, '0')}-${m2[2].padStart(2, '0')}-${m2[1]}`;
  }

  // DD-MM-YYYY (e.g. 11-08-2026)
  const m3 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m3) {
    return `${m3[1].padStart(2, '0')}-${m3[2].padStart(2, '0')}-${m3[3]}`;
  }

  return s;
}

// Convert YYYY-MM-DD input date to normalized DD-MM-YYYY
function normalizeInputDate(dateStr) {
  return normalizeSheetDate(dateStr);
}

// Helper to determine if a value represents "Present"
function isPresentValue(val) {
  if (!val) return false;
  const s = val.trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === '1' || s === 'checked' || s === 'present';
}

// Helper to parse date string (e.g., '10.06.2026', '10-06-2026', '10/06/2026')
function parseCalendarDate(str) {
  if (!str) return null;
  const clean = str.trim().replace(/\./g, '-').replace(/\//g, '-');
  const parts = clean.split('-');
  if (parts.length !== 3) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[2], 10);
  return new Date(year, month, day);
}

// Google Sheets Keys
const STUDENT_SHEET_KEY = import.meta.env.VITE_STUDENT_SHEET_KEY || "1mSW8MPo65d1KsonQHItoPByu4Hnc1z_MR4T44CX5TY8";       // MRU Student Sheet
const MRV_STUDENT_SHEET_KEY = import.meta.env.VITE_MRV_STUDENT_SHEET_KEY || "1n8brEk3tdruKiOqqVRmVqwSwjdAF0_OMO35yXdeb0LI";   // MRV Student Sheet
const INSTRUCTOR_SHEET_KEY = import.meta.env.VITE_INSTRUCTOR_SHEET_KEY || "1vr7OX1QvaxFTQYMlYOhLfYIvfG5m05KrXfx5K7B-Cls";    // Instructor Workload/Att Sheet



// MRU Academic Calendar Dataset (1st Year Students - B.Tech All Branches 2026-27)
const mruAcademicCalendarData = [
  // I Year I Semester
  { sno: 1, description: 'I Spell of Instructions', from: '29.07.2026', to: '29.09.2026', duration: '9 weeks', semester: 'I Year I Semester', department: 'MRU' },
  { sno: 2, description: 'Minor–I Examinations', from: '30.09.2026', to: '03.10.2026', duration: '1 week', semester: 'I Year I Semester', department: 'MRU' },
  { sno: 3, description: 'Submission of Minor–I Marks', from: '', to: '07.10.2026', duration: '-', semester: 'I Year I Semester', department: 'MRU' },
  { sno: 4, description: 'II Spell of Instructions', from: '05.10.2026', to: '17.10.2026', duration: '2 weeks', semester: 'I Year I Semester', department: 'MRU' },
  { sno: 5, description: 'Dussehra Holidays', from: '18.10.2026', to: '25.10.2026', duration: '1 week', semester: 'I Year I Semester', department: 'MRU' },
  { sno: 6, description: 'II Spell of Instructions (Continuation)', from: '26.10.2026', to: '02.12.2026', duration: '5 weeks', semester: 'I Year I Semester', department: 'MRU' },
  { sno: 7, description: 'Minor–II Examinations', from: '03.12.2026', to: '07.12.2026', duration: '1 week', semester: 'I Year I Semester', department: 'MRU' },
  { sno: 8, description: 'Submission of Minor–II Marks', from: '', to: '10.12.2026', duration: '-', semester: 'I Year I Semester', department: 'MRU' },
  { sno: 9, description: 'Practical Examinations', from: '08.12.2026', to: '11.12.2026', duration: '1 week', semester: 'I Year I Semester', department: 'MRU' },
  { sno: 10, description: 'End Semester Examinations (Regular)', from: '12.12.2026', to: '24.12.2026', duration: '2 weeks', semester: 'I Year I Semester', department: 'MRU' },
  { sno: 11, description: 'Commencement of II Semester', from: '', to: '28.12.2026', duration: '-', semester: 'I Year I Semester', department: 'MRU' },
  // I Year II Semester
  { sno: 1, description: 'I Spell of Instructions', from: '28.12.2026', to: '24.02.2027', duration: '8 weeks', semester: 'I Year II Semester', department: 'MRU' },
  { sno: 2, description: 'Minor I Examinations', from: '25.02.2027', to: '27.02.2027', duration: '1 week', semester: 'I Year II Semester', department: 'MRU' },
  { sno: 3, description: 'Submission of Minor I Exam Marks', from: '', to: '04.03.2027', duration: '-', semester: 'I Year II Semester', department: 'MRU' },
  { sno: 4, description: 'II Spell of Instructions Continuation', from: '01.03.2027', to: '13.04.2027', duration: '6 weeks', semester: 'I Year II Semester', department: 'MRU' },
  { sno: 5, description: 'Minor II Examinations', from: '14.04.2027', to: '17.04.2027', duration: '1 week', semester: 'I Year II Semester', department: 'MRU' },
  { sno: 6, description: 'Practical Examinations', from: '19.04.2027', to: '23.04.2027', duration: '1 week', semester: 'I Year II Semester', department: 'MRU' },
  { sno: 7, description: 'Submission of Minor II Marks', from: '', to: '28.04.2027', duration: '-', semester: 'I Year II Semester', department: 'MRU' },
  { sno: 8, description: 'End Semester Examinations (Regular)', from: '24.04.2027', to: '07.05.2027', duration: '2 weeks', semester: 'I Year II Semester', department: 'MRU' },
  { sno: 9, description: 'Summer Vacation', from: '10.05.2027', to: '05.06.2027', duration: '4 weeks', semester: 'I Year II Semester', department: 'MRU' },
  { sno: 10, description: 'Commencement of Class work for I Semester for Academic Year 2027-2028', from: '', to: '07.06.2027', duration: '-', semester: 'I Year II Semester', department: 'MRU' }
];

// MRV Academic Calendar Dataset (2nd Year Students - Admitted Batch 2025-26 Year 2026-27)
const mrvAcademicCalendarData = [
  // II Year I Semester
  { sno: 1, description: 'Commencement of I semester classwork', from: '', to: '10.06.2026', duration: '-', semester: 'II Year I Semester', department: 'MRV' },
  { sno: 2, description: '1st Spell of Instructions', from: '10.06.2026', to: '12.08.2026', duration: '9 weeks', semester: 'II Year I Semester', department: 'MRV' },
  { sno: 3, description: 'First Mid Term Examinations', from: '13.08.2026', to: '20.08.2026', duration: '1 week', semester: 'II Year I Semester', department: 'MRV' },
  { sno: 4, description: 'Submission of First Mid Term Exam Marks', from: '', to: '25.08.2026', duration: '-', semester: 'II Year I Semester', department: 'MRV' },
  { sno: 5, description: '2nd Spell of Instructions', from: '13.08.2026', to: '16.10.2026', duration: '8 weeks', semester: 'II Year I Semester', department: 'MRV' },
  { sno: 6, description: 'Dussehra Recess', from: '17.10.2026', to: '21.10.2026', duration: '1 week', semester: 'II Year I Semester', department: 'MRV' },
  { sno: 7, description: 'Second Mid Term Examinations', from: '22.10.2026', to: '28.10.2026', duration: '1 week', semester: 'II Year I Semester', department: 'MRV' },
  { sno: 8, description: 'Submission of Mid Term Exam Marks', from: '', to: '30.10.2026', duration: '-', semester: 'II Year I Semester', department: 'MRV' },
  { sno: 9, description: 'Practical Examinations', from: '29.10.2026', to: '03.11.2026', duration: '1 week', semester: 'II Year I Semester', department: 'MRV' },
  { sno: 10, description: 'Preparation Holidays', from: '04.11.2026', to: '07.11.2026', duration: '1 week', semester: 'II Year I Semester', department: 'MRV' },
  { sno: 11, description: 'End Semester Examinations', from: '10.11.2026', to: '20.11.2026', duration: '2 weeks', semester: 'II Year I Semester', department: 'MRV' },
  // II Year II Semester
  { sno: 1, description: 'Commencement of II semester classwork', from: '', to: '23.11.2026', duration: '-', semester: 'II Year II Semester', department: 'MRV' },
  { sno: 2, description: '1st Spell of Instructions', from: '23.11.2026', to: '16.01.2027', duration: '9 weeks', semester: 'II Year II Semester', department: 'MRV' },
  { sno: 3, description: 'First Mid Term Examinations', from: '18.01.2027', to: '23.01.2027', duration: '1 week', semester: 'II Year II Semester', department: 'MRV' },
  { sno: 4, description: 'Submission of First Mid Term Exam Marks', from: '', to: '27.01.2027', duration: '-', semester: 'II Year II Semester', department: 'MRV' },
  { sno: 5, description: '2nd Spell of Instructions', from: '25.01.2027', to: '27.03.2027', duration: '8 weeks', semester: 'II Year II Semester', department: 'MRV' },
  { sno: 6, description: 'Second Mid Term Examinations', from: '29.03.2027', to: '03.04.2027', duration: '1 week', semester: 'II Year II Semester', department: 'MRV' },
  { sno: 7, description: 'Submission of Mid Term Exam Marks', from: '', to: '05.04.2027', duration: '-', semester: 'II Year II Semester', department: 'MRV' },
  { sno: 8, description: 'Practical Examinations', from: '05.04.2027', to: '09.04.2027', duration: '1 week', semester: 'II Year II Semester', department: 'MRV' },
  { sno: 9, description: 'Preparation Holidays', from: '10.04.2027', to: '15.04.2027', duration: '1 week', semester: 'II Year II Semester', department: 'MRV' },
  { sno: 10, description: 'End Semester Examinations', from: '16.04.2027', to: '28.04.2027', duration: '2 weeks', semester: 'II Year II Semester', department: 'MRV' }
];



// Pure helper to compute normalized student attendance & section stats for any date, department and section
function processStudentAttendanceData({
  morningHeaders = [],
  morningRows = [],
  afternoonHeaders = [],
  afternoonRows = [],
  mrvMorningRows = [],
  mrvAfternoonRows = [],
  mrvDashRows = [],
  targetDate = todayDateStr(),
  targetDept = 'ALL',
  targetSection = 'All Sections'
}) {
  const targetNormDate = normalizeInputDate(targetDate);
  const filterSec = targetSection ? targetSection.trim().toLowerCase() : 'all sections';

  const sectionSet = new Set();
  let mruStudentsList = [];
  let mrvStudentsList = [];
  let mruSecStatsMap = {};
  let mrvSecStatsMap = {};

  // 1. Process MRU Student Attendance Data
  if (morningRows.length > 0 || afternoonRows.length > 0) {
    let morningIdIdx = 0, morningNameIdx = 1, morningSecIdx = 2, morningUidIdx = 3;
    morningHeaders.forEach((h, idx) => {
      const title = h.trim().toLowerCase();
      if (title === 'id' || title === 'student id') morningIdIdx = idx;
      if (title === 'student name' || title === 'name') morningNameIdx = idx;
      if (title === 'uid') morningUidIdx = idx;
      if (title === 'section') morningSecIdx = idx;
    });

    let afternoonNameIdx = 1, afternoonIdIdx = 2, afternoonSecIdx = 3, afternoonUidIdx = 4;
    afternoonHeaders.forEach((h, idx) => {
      const title = h.trim().toLowerCase();
      if (title === 'student name' || title === 'name') afternoonNameIdx = idx;
      if (title === 'id' || title === 'student id') afternoonIdIdx = idx;
      if (title === 'uid') afternoonUidIdx = idx;
      if (title === 'section') afternoonSecIdx = idx;
    });

    let morningDateIdx = -1;
    morningHeaders.forEach((h, idx) => {
      if (normalizeSheetDate(h) === targetNormDate) morningDateIdx = idx;
    });

    let afternoonDateIdx = -1;
    afternoonHeaders.forEach((h, idx) => {
      if (normalizeSheetDate(h) === targetNormDate) afternoonDateIdx = idx;
    });

    const morningAllDateIndices = [];
    morningHeaders.forEach((h, idx) => {
      if (normalizeSheetDate(h)) morningAllDateIndices.push(idx);
    });

    const afternoonAllDateIndices = [];
    afternoonHeaders.forEach((h, idx) => {
      if (normalizeSheetDate(h)) afternoonAllDateIndices.push(idx);
    });

    // Extract MRU sections
    morningRows.forEach(r => {
      if (r.length > morningSecIdx) {
        const val = r[morningSecIdx].trim();
        if (val && (val.toLowerCase().startsWith('s-') || val.toLowerCase().startsWith('s0'))) sectionSet.add(val);
      }
    });

    const mruMatchedMap = new Map();
    morningRows.forEach(row => {
      if (row.length <= Math.max(morningNameIdx, morningIdIdx)) return;
      const name = row[morningNameIdx] ? row[morningNameIdx].trim() : '';
      const id = row[morningIdIdx] ? row[morningIdIdx].trim() : '';
      const uid = row[morningUidIdx] ? row[morningUidIdx].trim() : '';
      const section = row[morningSecIdx] ? row[morningSecIdx].trim() : '';

      if (!name && !id) return;
      if (name.toLowerCase().includes('student name') || id.toLowerCase().includes('id')) return;

      const isPresent = morningDateIdx !== -1 && row.length > morningDateIdx ? isPresentValue(row[morningDateIdx]) : false;

      let mPresentAll = 0;
      morningAllDateIndices.forEach(colIdx => {
        if (colIdx < row.length && isPresentValue(row[colIdx])) mPresentAll++;
      });

      const key = id ? `id:${id}` : uid ? `uid:${uid}` : `name:${name.toLowerCase()}_sec:${section.toLowerCase()}`;
      mruMatchedMap.set(key, {
        id, name, uid, section, department: 'MRU',
        morningStatus: isPresent ? 'Present' : 'Absent',
        afternoonStatus: 'Absent',
        mPresentAll, aPresentAll: 0,
        cumTotal: morningAllDateIndices.length + afternoonAllDateIndices.length
      });
    });

    afternoonRows.forEach(row => {
      if (row.length <= Math.max(afternoonNameIdx, afternoonIdIdx)) return;
      const name = row[afternoonNameIdx] ? row[afternoonNameIdx].trim() : '';
      const id = row[afternoonIdIdx] ? row[afternoonIdIdx].trim() : '';
      const uid = row[afternoonUidIdx] ? row[afternoonUidIdx].trim() : '';
      const section = row[afternoonSecIdx] ? row[afternoonSecIdx].trim() : '';

      if (!name && !id) return;
      if (name.toLowerCase().includes('student name') || id.toLowerCase().includes('id')) return;

      const isPresent = afternoonDateIdx !== -1 && row.length > afternoonDateIdx ? isPresentValue(row[afternoonDateIdx]) : false;

      let aPresentAll = 0;
      afternoonAllDateIndices.forEach(colIdx => {
        if (colIdx < row.length && isPresentValue(row[colIdx])) aPresentAll++;
      });

      const key = id ? `id:${id}` : uid ? `uid:${uid}` : `name:${name.toLowerCase()}_sec:${section.toLowerCase()}`;
      if (mruMatchedMap.has(key)) {
        const existing = mruMatchedMap.get(key);
        existing.afternoonStatus = isPresent ? 'Present' : 'Absent';
        existing.aPresentAll = aPresentAll;
      } else {
        mruMatchedMap.set(key, {
          id, name, uid, section, department: 'MRU',
          morningStatus: 'Absent',
          afternoonStatus: isPresent ? 'Present' : 'Absent',
          mPresentAll: 0, aPresentAll,
          cumTotal: morningAllDateIndices.length + afternoonAllDateIndices.length
        });
      }
    });

    mruStudentsList = Array.from(mruMatchedMap.values()).map(s => {
      const tot = s.mPresentAll + s.aPresentAll;
      const pct = s.cumTotal > 0 ? ((tot / s.cumTotal) * 100).toFixed(1) : '0.0';
      return { ...s, totalPresentSessions: tot, overallPct: parseFloat(pct) };
    });

    // Compute MRU section stats (S-01 to S-10)
    morningRows.forEach(row => {
      if (row.length <= Math.max(morningNameIdx, morningIdIdx)) return;
      const name = row[morningNameIdx] ? row[morningNameIdx].trim() : '';
      const sec = row[morningSecIdx] ? row[morningSecIdx].trim() : '';
      if (!name || !sec || (!sec.toLowerCase().startsWith('s-') && !sec.toLowerCase().startsWith('s0') && !sec.toLowerCase().startsWith('s1'))) return;
      if (!mruSecStatsMap[sec]) mruSecStatsMap[sec] = { section: sec, department: 'MRU', mPresent: 0, mTotal: 0, aPresent: 0, aTotal: 0 };
      mruSecStatsMap[sec].mTotal += 1;
      if (morningDateIdx !== -1 && row.length > morningDateIdx && isPresentValue(row[morningDateIdx])) {
        mruSecStatsMap[sec].mPresent += 1;
      }
    });
    afternoonRows.forEach(row => {
      if (row.length <= Math.max(afternoonNameIdx, afternoonIdIdx)) return;
      const name = row[afternoonNameIdx] ? row[afternoonNameIdx].trim() : '';
      const sec = row[afternoonSecIdx] ? row[afternoonSecIdx].trim() : '';
      if (!name || !sec || (!sec.toLowerCase().startsWith('s-') && !sec.toLowerCase().startsWith('s0') && !sec.toLowerCase().startsWith('s1'))) return;
      if (!mruSecStatsMap[sec]) mruSecStatsMap[sec] = { section: sec, department: 'MRU', mPresent: 0, mTotal: 0, aPresent: 0, aTotal: 0 };
      mruSecStatsMap[sec].aTotal += 1;
      if (afternoonDateIdx !== -1 && row.length > afternoonDateIdx && isPresentValue(row[afternoonDateIdx])) {
        mruSecStatsMap[sec].aPresent += 1;
      }
    });
  }

  // 2. Process MRV Student Attendance Data
  if (mrvMorningRows.length > 1 && mrvDashRows.length > 1) {
    const mrvDateColMap = {};
    for (let idx = 1; idx < mrvDashRows.length; idx++) {
      const row = mrvDashRows[idx];
      if (!row || !row[0]) continue;
      const rawDate = row[0].trim();
      const normD = normalizeSheetDate(rawDate);
      mrvDateColMap[normD] = 9 + idx;
    }

    const mrvTargetColIdx = mrvDateColMap[targetNormDate];
    const mrvTotalDateCols = Object.keys(mrvDateColMap).length;

    for (let i = 1; i < mrvMorningRows.length; i++) {
      const r = mrvMorningRows[i];
      if (r && r.length > 2 && r[2].trim()) {
        sectionSet.add(r[2].trim());
      }
    }

    const mrvMatchedMap = new Map();
    for (let i = 1; i < mrvMorningRows.length; i++) {
      const rM = mrvMorningRows[i];
      if (!rM || rM.length < 3) continue;
      const id = rM[0].trim();
      const name = rM[1].trim();
      const section = rM[2].trim();
      const niatId = rM.length > 3 ? rM[3].trim() : '';
      const uid = rM.length > 4 ? rM[4].trim() : '';
      if (!name && !id) continue;

      const isMPresent = mrvTargetColIdx !== undefined && rM.length > mrvTargetColIdx ? isPresentValue(rM[mrvTargetColIdx]) : false;

      let mPresentAll = 0;
      Object.values(mrvDateColMap).forEach(colI => {
        if (colI < rM.length && isPresentValue(rM[colI])) mPresentAll++;
      });

      const rA = mrvAfternoonRows.find((ra, idx) => idx > 0 && ra.length > 2 && (ra[0].trim() === id || (ra[1].trim().toLowerCase() === name.toLowerCase() && ra[2].trim().toLowerCase() === section.toLowerCase())));
      const isAPresent = rA && mrvTargetColIdx !== undefined && rA.length > mrvTargetColIdx ? isPresentValue(rA[mrvTargetColIdx]) : false;

      let aPresentAll = 0;
      if (rA) {
        Object.values(mrvDateColMap).forEach(colI => {
          if (colI < rA.length && isPresentValue(rA[colI])) aPresentAll++;
        });
      }

      const key = id ? `mrv_id:${id}` : uid ? `mrv_uid:${uid}` : `mrv_name:${name.toLowerCase()}_sec:${section.toLowerCase()}`;
      mrvMatchedMap.set(key, {
        id: id || niatId, name, uid, section, department: 'MRV',
        morningStatus: isMPresent ? 'Present' : 'Absent',
        afternoonStatus: isAPresent ? 'Present' : 'Absent',
        mPresentAll, aPresentAll,
        cumTotal: mrvTotalDateCols * 2
      });
    }

    mrvStudentsList = Array.from(mrvMatchedMap.values()).map(s => {
      const tot = s.mPresentAll + s.aPresentAll;
      const pct = s.cumTotal > 0 ? ((tot / s.cumTotal) * 100).toFixed(1) : '0.0';
      return { ...s, totalPresentSessions: tot, overallPct: parseFloat(pct) };
    });

    for (let i = 1; i < mrvMorningRows.length; i++) {
      const rM = mrvMorningRows[i];
      if (!rM || rM.length < 3) continue;
      const sec = rM[2].trim();
      if (!sec) continue;
      if (!mrvSecStatsMap[sec]) mrvSecStatsMap[sec] = { section: sec, department: 'MRV', mPresent: 0, mTotal: 0, aPresent: 0, aTotal: 0 };
      mrvSecStatsMap[sec].mTotal += 1;
      if (mrvTargetColIdx !== undefined && rM.length > mrvTargetColIdx && isPresentValue(rM[mrvTargetColIdx])) {
        mrvSecStatsMap[sec].mPresent += 1;
      }

      const rA = mrvAfternoonRows.find((ra, idx) => idx > 0 && ra.length > 2 && (ra[0].trim() === rM[0].trim() || (ra[1].trim().toLowerCase() === rM[1].trim().toLowerCase() && ra[2].trim().toLowerCase() === sec.toLowerCase())));
      if (rA) {
        mrvSecStatsMap[sec].aTotal += 1;
        if (mrvTargetColIdx !== undefined && rA.length > mrvTargetColIdx && isPresentValue(rA[mrvTargetColIdx])) {
          mrvSecStatsMap[sec].aPresent += 1;
        }
      }
    }
  }

  // 3. Filter by department
  let activeStudents = [];
  let activeSecMapList = [];

  if (targetDept === 'MRU') {
    activeStudents = mruStudentsList;
    activeSecMapList = Object.values(mruSecStatsMap);
  } else if (targetDept === 'MRV') {
    activeStudents = mrvStudentsList;
    activeSecMapList = Object.values(mrvSecStatsMap);
  } else {
    activeStudents = [...mruStudentsList, ...mrvStudentsList];
    activeSecMapList = [...Object.values(mruSecStatsMap), ...Object.values(mrvSecStatsMap)];
  }

  const filteredBySecStudents = activeStudents.filter(s => {
    if (filterSec === 'all sections') return true;
    return s.section.trim().toLowerCase() === filterSec;
  });

  const mTotal = filteredBySecStudents.length;
  const mPresent = filteredBySecStudents.filter(s => s.morningStatus === 'Present').length;
  const mAbsent = mTotal - mPresent;

  const aTotal = filteredBySecStudents.length;
  const aPresent = filteredBySecStudents.filter(s => s.afternoonStatus === 'Present').length;
  const aAbsent = aTotal - aPresent;

  const missed = filteredBySecStudents.filter(s => s.morningStatus === 'Present' && s.afternoonStatus === 'Absent');

  const computedSecStats = activeSecMapList.map(item => {
    const overallPresent = item.mPresent + item.aPresent;
    const overallTotal = item.mTotal + item.aTotal;
    const overallPct = overallTotal > 0 ? Math.round((overallPresent / overallTotal) * 100) : 0;
    const mPct = item.mTotal > 0 ? Math.round((item.mPresent / item.mTotal) * 100) : 0;
    const aPct = item.aTotal > 0 ? Math.round((item.aPresent / item.aTotal) * 100) : 0;

    return {
      section: item.section,
      department: item.department,
      mPresent: item.mPresent,
      mTotal: item.mTotal,
      mPct,
      aPresent: item.aPresent,
      aTotal: item.aTotal,
      aPct,
      overallPresent,
      overallTotal,
      overallPct
    };
  }).sort((a, b) => a.section.localeCompare(b.section));

  return {
    allSections: ['All Sections', ...Array.from(sectionSet).sort()],
    studentDetails: filteredBySecStudents,
    sectionStats: computedSecStats,
    missedAfterMorning: missed,
    stats: {
      morningTotal: mTotal,
      morningPresent: mPresent,
      morningAbsent: mAbsent,
      afternoonTotal: aTotal,
      afternoonPresent: aPresent,
      afternoonAbsent: aAbsent,
      missedAfterMorning: missed
    }
  };
}

export default function App() {
  // Theme & Login State
  const [theme, setTheme] = useState('dark');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // ── API / Login State ─────────────────────────────────────────────────
  // Authentication is now token-based (JWT via /api/auth).
  // No credentials are stored in the frontend.
  const [loginLoading, setLoginLoading] = useState(false);
  const [currentUsername, setCurrentUsername] = useState(() => {
    try { return localStorage.getItem('hod_username') || 'vamshiyadav'; } catch (e) { return 'vamshiyadav'; }
  });

  // Top-Level Navigation Module
  const [activeModule, setActiveModule] = useState('students');

  // Instructor Sub-Tab ('workload' | 'attendance' | 'progress')
  const [instructorSubTab, setInstructorSubTab] = useState('workload');

  // =====================================================================
  // NOTES & REMINDERS STATE
  // =====================================================================
  // Reminders are loaded from MongoDB after login — start with empty array.
  const [reminders, setReminders] = useState([]);
  const [remindersLoading, setRemindersLoading] = useState(false);
  const [remindersError, setRemindersError] = useState(null);
  const [reminderFilter, setReminderFilter] = useState('Upcoming'); // 'Upcoming' | 'Completed' | 'All'
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [editingReminder, setEditingReminder] = useState(null); // null = new, object = edit
  const [reminderForm, setReminderForm] = useState(emptyForm());
  const [reminderFormErrors, setReminderFormErrors] = useState({});
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  // Notification Bell (Dashboard notifications from MongoDB)
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef(null);
  const [dbNotifications, setDbNotifications] = useState([]);

  // Push notification permission status (safe for all mobile environments)
  const [pushPermission, setPushPermission] = useState(() => {
    try {
      return typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported';
    } catch (e) {
      return 'unsupported';
    }
  });
  const [swRegistration, setSwRegistration] = useState(null);
  const [deviceRegistered, setDeviceRegistered] = useState(false);

  // Settings Module State
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [settingsStatus, setSettingsStatus] = useState({ type: '', message: '' });

  // Academic Calendar State & Filters
  const [calendarDeptFilter, setCalendarDeptFilter] = useState('MRU');
  const [calendarSemFilter, setCalendarSemFilter] = useState('All Semesters');
  const [calendarSearch, setCalendarSearch] = useState('');
  const [calendarRefDate, setCalendarRefDate] = useState(() => todayDateStr());

  // --- ATTENTION REQUIRED STATE & FILTERS ---
  const [attentionDate, setAttentionDate] = useState(() => todayDateStr());
  const [attentionDeptFilter, setAttentionDeptFilter] = useState('ALL'); // 'ALL' | 'MRU' | 'MRV'
  const [attentionStudentModal, setAttentionStudentModal] = useState(null);

  // --- STUDENT ATTENDANCE STATE ---
  const [selectedDate, setSelectedDate] = useState(() => todayDateStr());
  const [selectedSection, setSelectedSection] = useState('All Sections');
  const [studentDeptFilter, setStudentDeptFilter] = useState('ALL'); // 'ALL' | 'MRU' | 'MRV'
  const [sections, setSections] = useState([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mrvError, setMrvError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // MRU Student Raw Rows & Headers
  const [morningRows, setMorningRows] = useState([]);
  const [afternoonRows, setAfternoonRows] = useState([]);
  const [morningHeaders, setMorningHeaders] = useState([]);
  const [afternoonHeaders, setAfternoonHeaders] = useState([]);

  // MRV Student Raw Rows & Headers
  const [mrvMorningRows, setMrvMorningRows] = useState([]);
  const [mrvAfternoonRows, setMrvAfternoonRows] = useState([]);
  const [mrvDashRows, setMrvDashRows] = useState([]);

  const [stats, setStats] = useState({
    morningTotal: 0,
    morningPresent: 0,
    morningAbsent: 0,
    afternoonTotal: 0,
    afternoonPresent: 0,
    afternoonAbsent: 0,
    missedAfterMorning: []
  });

  const [studentDetails, setStudentDetails] = useState([]);
  const [sectionStats, setSectionStats] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  // --- INSTRUCTOR MODULE STATE ---
  const [workloadDeptFilter, setWorkloadDeptFilter] = useState('All');
  const [workloadSearch, setWorkloadSearch] = useState('');
  const [workloadList, setWorkloadList] = useState([]);

  const [progressDeptFilter, setProgressDeptFilter] = useState('All');
  const [subjectProgressList, setSubjectProgressList] = useState([]);

  const [instructorDate, setInstructorDate] = useState(() => todayDateStr());
  const [instructorDeptFilter, setInstructorDeptFilter] = useState('All');
  const [instructorAttendanceList, setInstructorAttendanceList] = useState([]);

  // Expanded Instructor Drawer State
  const [expandedInstructorIds, setExpandedInstructorIds] = useState(new Set());

  // Selected Instructor for Detail Modal
  const [selectedInstructorModal, setSelectedInstructorModal] = useState(null);

  // Apply Theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Reset student pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedDate, selectedSection, studentDeptFilter]);

  // Reset semester filter when calendar department changes
  useEffect(() => {
    setCalendarSemFilter('All Semesters');
  }, [calendarDeptFilter]);

  // ── Fetch reminders from MongoDB API ────────────────────────────────
  const fetchReminders = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      setRemindersLoading(true);
      setRemindersError(null);
      const data = await api.getReminders();
      setReminders(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('[REMINDERS] Fetch error:', err);
      setRemindersError(err.message);
      // If token expired, log out
      if (err.message.includes('Unauthorized') || err.message.includes('expired')) {
        api.logout();
        setIsLoggedIn(false);
      }
    } finally {
      setRemindersLoading(false);
    }
  }, [isLoggedIn]);

  // ── Fetch dashboard bell notifications from MongoDB API ────────────
  const fetchNotifications = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      const data = await api.getNotifications();
      setDbNotifications(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('[NOTIFICATIONS] Fetch error:', err);
    }
  }, [isLoggedIn]);

  // Load reminders & notifications after login
  useEffect(() => {
    if (isLoggedIn) {
      fetchReminders();
      fetchNotifications();
    }
  }, [isLoggedIn, fetchReminders, fetchNotifications]);

  // 60-second polling: sync reminders & notifications from server
  useEffect(() => {
    if (!isLoggedIn) return;
    const interval = setInterval(() => {
      fetchReminders();
      fetchNotifications();
    }, 60000);
    return () => clearInterval(interval);
  }, [isLoggedIn, fetchReminders, fetchNotifications]);

  // Register Service Worker for Web Push
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => {
          setSwRegistration(reg);
        })
        .catch(err => {
          console.warn('Service Worker registration failed:', err);
        });
    }
  }, []);

  // Close bell dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (bellRef.current && !bellRef.current.contains(e.target)) {
        setBellOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // =====================================================================
  // NOTES & REMINDERS COMPUTED VALUES
  // =====================================================================
  const today = todayDateStr();

  const upcomingReminders = reminders
    .filter(r => !r.completed)
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));

  const completedReminders = reminders
    .filter(r => r.completed)
    .sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`));

  const todaysReminders = reminders
    .filter(r => !r.completed && r.date === today)
    .sort((a, b) => a.time.localeCompare(b.time));

  const displayedReminders = reminderFilter === 'Upcoming'
    ? upcomingReminders
    : reminderFilter === 'Completed'
      ? completedReminders
      : [...reminders].sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));

  // Unread dashboard notifications from MongoDB
  const unreadBellCount = dbNotifications.filter(n => !n.read).length;

  const bellNotifications = dbNotifications
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  // =====================================================================
  // NOTES & REMINDERS HANDLERS
  // =====================================================================

  const openAddModal = () => {
    setEditingReminder(null);
    setReminderForm(emptyForm());
    setReminderFormErrors({});
    setShowReminderModal(true);
  };

  const openEditModal = (reminder) => {
    setEditingReminder(reminder);
    setReminderForm({
      title: reminder.title,
      description: reminder.description || '',
      date: reminder.date,
      time: reminder.time,
      priority: reminder.priority || 'Medium',
      dashboardNotification: reminder.dashboardNotification ?? true,
      pushNotification: reminder.pushNotification ?? true
    });
    setReminderFormErrors({});
    setShowReminderModal(true);
  };

  const closeModal = () => {
    setShowReminderModal(false);
    setEditingReminder(null);
    setReminderFormErrors({});
  };

  const validateReminderForm = () => {
    const errors = {};
    if (!reminderForm.title.trim()) errors.title = 'Title is required.';
    if (!reminderForm.date) errors.date = 'Date is required.';
    if (!reminderForm.time) errors.time = 'Time is required.';
    setReminderFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveReminder = async () => {
    if (!validateReminderForm()) return;
    try {
      if (editingReminder) {
        // Update existing via API
        const reminderId = editingReminder._id || editingReminder.id;
        await api.updateReminder(reminderId, {
          title: reminderForm.title.trim(),
          description: reminderForm.description.trim(),
          date: reminderForm.date,
          time: reminderForm.time,
          priority: reminderForm.priority,
          dashboardNotification: reminderForm.dashboardNotification,
          pushNotification: reminderForm.pushNotification,
        });
      } else {
        // Create new via API
        await api.createReminder({
          title: reminderForm.title.trim(),
          description: reminderForm.description.trim(),
          date: reminderForm.date,
          time: reminderForm.time,
          priority: reminderForm.priority,
          dashboardNotification: reminderForm.dashboardNotification,
          pushNotification: reminderForm.pushNotification,
        });
      }
      closeModal();
      await fetchReminders();
    } catch (err) {
      alert(`Failed to save reminder: ${err.message}`);
    }
  };

  const toggleReminderComplete = async (id) => {
    const reminder = reminders.find(r => (r._id || r.id) === id);
    if (!reminder) return;
    try {
      await api.updateReminder(id, { completed: !reminder.completed });
      await fetchReminders();
    } catch (err) {
      console.error('Toggle complete error:', err);
    }
  };

  const confirmDeleteReminder = (id) => {
    setDeleteConfirmId(id);
  };

  const handleDeleteReminder = async () => {
    if (deleteConfirmId) {
      try {
        await api.deleteReminder(deleteConfirmId);
        setDeleteConfirmId(null);
        await fetchReminders();
        await fetchNotifications();
      } catch (err) {
        alert(`Failed to delete reminder: ${err.message}`);
        setDeleteConfirmId(null);
      }
    }
  };

  const markBellSeen = async () => {
    try {
      await api.markNotificationsRead();
      await fetchNotifications();
    } catch (err) {
      console.error('Mark bell seen error:', err);
    }
  };

  // ── VAPID helper: convert base64 URL string to Uint8Array ──────────
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  const enablePushNotifications = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPushPermission('unsupported');
      alert('Mobile notifications are not supported on this browser.');
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setPushPermission(permission);

      if (permission === 'granted') {
        // Register / reuse service worker
        let reg = swRegistration;
        if ('serviceWorker' in navigator) {
          try {
            reg = await navigator.serviceWorker.register('/sw.js');
            setSwRegistration(reg);
            await navigator.serviceWorker.ready;
          } catch (e) {
            console.warn('SW registration:', e);
          }
        }

        // Subscribe to Web Push with VAPID public key
        const vapidPublicKey = api.getVapidPublicKey();
        if (vapidPublicKey && reg) {
          try {
            let subscription = await reg.pushManager.getSubscription();
            if (!subscription) {
              subscription = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
              });
            }

            // Detect platform
            const ua = navigator.userAgent || '';
            let platform = 'desktop';
            if (/iPhone|iPad|iPod/.test(ua)) platform = 'ios';
            else if (/Android/.test(ua)) platform = 'android';

            // Register with backend
            await api.registerDevice(subscription.toJSON(), platform);
            setDeviceRegistered(true);
          } catch (subErr) {
            console.warn('Push subscription error:', subErr);
          }
        }

        // Send instant test notification so the user sees sound & banner immediately
        setTimeout(() => {
          showAppNotification(
            '🔔 Notifications Enabled!',
            'Academic ERP will now deliver your scheduled reminder alerts to this device.'
          );
        }, 400);
      }
    } catch (e) {
      console.error('Error enabling push notifications:', e);
    }
  };

  // --- FETCH ALL LIVE DATA FROM GOOGLE SHEETS ---
  const fetchAllData = async () => {
    setLoading(true);
    setError(null);
    setMrvError(null);
    try {
      // 1. Fetch MRU Student Attendance Sheets
      const morningRes = await fetch(`https://docs.google.com/spreadsheets/d/${STUDENT_SHEET_KEY}/export?format=csv&gid=92629465`);
      const morningParsed = parseCSV(await morningRes.text());
      const afternoonRes = await fetch(`https://docs.google.com/spreadsheets/d/${STUDENT_SHEET_KEY}/export?format=csv&gid=1675584981`);
      const afternoonParsed = parseCSV(await afternoonRes.text());

      if (morningParsed.length > 0) {
        setMorningHeaders(morningParsed[0]);
        setMorningRows(morningParsed.slice(1));
      }
      if (afternoonParsed.length > 0) {
        setAfternoonHeaders(afternoonParsed[0]);
        setAfternoonRows(afternoonParsed.slice(1));
      }

      // 2. Fetch MRV Student Attendance Subsheets via GViz CSV
      try {
        const mrvDashRes = await fetch(`https://docs.google.com/spreadsheets/d/${MRV_STUDENT_SHEET_KEY}/gviz/tq?sheet=${encodeURIComponent('Attendance_Dashboard')}&tqx=out:csv`);
        const mrvDashParsed = parseCSV(await mrvDashRes.text());
        setMrvDashRows(mrvDashParsed);

        const mrvMRes = await fetch(`https://docs.google.com/spreadsheets/d/${MRV_STUDENT_SHEET_KEY}/gviz/tq?sheet=${encodeURIComponent('Morning_Attendance')}&tqx=out:csv`);
        const mrvMParsed = parseCSV(await mrvMRes.text());
        setMrvMorningRows(mrvMParsed);

        const mrvARes = await fetch(`https://docs.google.com/spreadsheets/d/${MRV_STUDENT_SHEET_KEY}/gviz/tq?sheet=${encodeURIComponent('Afternoon_Attendance')}&tqx=out:csv`);
        const mrvAParsed = parseCSV(await mrvARes.text());
        setMrvAfternoonRows(mrvAParsed);
      } catch (mErr) {
        console.error("MRV Student Sheet fetch error:", mErr);
        setMrvError("Unable to load MRV attendance data.");
      }

      // 3. Fetch Instructor Sheets (Workload, Progress, Attendance)
      const mruWorkloadRes = await fetch(`https://docs.google.com/spreadsheets/d/${INSTRUCTOR_SHEET_KEY}/export?format=csv&gid=0`);
      const mruRows = parseCSV(await mruWorkloadRes.text());

      const mrvWorkloadRes = await fetch(`https://docs.google.com/spreadsheets/d/${INSTRUCTOR_SHEET_KEY}/export?format=csv&gid=408940179`);
      const mrvRows = parseCSV(await mrvWorkloadRes.text());

      const mruAttRes = await fetch(`https://docs.google.com/spreadsheets/d/${INSTRUCTOR_SHEET_KEY}/export?format=csv&gid=169295533`);
      const mruAttRows = parseCSV(await mruAttRes.text());

      const mrvAttRes = await fetch(`https://docs.google.com/spreadsheets/d/${INSTRUCTOR_SHEET_KEY}/export?format=csv&gid=1821937974`);
      const mrvAttRows = parseCSV(await mrvAttRes.text());

      // --- PARSE WORKLOAD WITH FORWARD-FILL ---
      const parseWorkloadSheet = (rows, dept) => {
        const list = [];
        if (rows.length < 3) return list;
        let currentSubject = '';
        for (let i = 3; i < rows.length; i++) {
          const r = rows[i];
          if (!r || r.length < 5) continue;
          const rawSub = r[0].trim();
          const instName = r[1].trim();
          const lectStr = r[2].trim();
          const pracStr = r[3].trim();
          const totStr = r[4].trim();

          if (rawSub.toLowerCase() === 'subject' || instName.toLowerCase() === 'instructors') break;
          if (!instName && !lectStr && !pracStr) continue;

          if (rawSub) currentSubject = rawSub;

          const lectures = parseInt(lectStr, 10) || 0;
          const practices = parseInt(pracStr, 10) || 0;
          const total = parseInt(totStr, 10) || (lectures + practices);

          if (instName) {
            list.push({
              subject: currentSubject,
              instructor: instName,
              lectures,
              practices,
              total,
              department: dept
            });
          }
        }
        return list;
      };

      const mruW = parseWorkloadSheet(mruRows, 'MRU');
      const mrvW = parseWorkloadSheet(mrvRows, 'MRV');
      setWorkloadList([...mruW, ...mrvW]);

      // --- PARSE SUBJECT PROGRESS ---
      const parseProgressSheet = (rows, dept) => {
        const list = [];
        let headerIdx = -1;
        for (let i = 0; i < rows.length; i++) {
          if (rows[i] && rows[i].length > 2 && rows[i][0].trim().toLowerCase() === 'subject' && rows[i][1].trim().toLowerCase().includes('session')) {
            headerIdx = i;
            break;
          }
        }
        if (headerIdx !== -1) {
          for (let i = headerIdx + 1; i < rows.length; i++) {
            const r = rows[i];
            if (!r || !r[0].trim()) continue;
            const sub = r[0].trim();
            const totalSess = parseInt(r[1].trim(), 10) || 0;
            const completedSess = parseInt(r[2].trim(), 10) || 0;
            const avgStr = r.length > 3 ? r[3].trim() : '';
            const proRataStr = r.length > 4 ? r[4].trim() : '';
            const calcAvg = totalSess > 0 ? (completedSess / totalSess * 100).toFixed(2) : '0.00';

            list.push({
              subject: sub,
              totalSessions: totalSess,
              completedSessions: completedSess,
              average: avgStr || `${calcAvg}%`,
              calculatedAvg: parseFloat(calcAvg),
              proRata: proRataStr,
              department: dept
            });
          }
        }
        return list;
      };

      const mruP = parseProgressSheet(mruRows, 'MRU');
      const mrvP = parseProgressSheet(mrvRows, 'MRV');
      setSubjectProgressList([...mruP, ...mrvP]);

      // --- PARSE INSTRUCTOR ATTENDANCE ---
      const parseAttendanceSheet = (rows, dept) => {
        const list = [];
        if (!rows || rows.length < 2) return list;
        const headers = rows[0];
        const dateCols = {};
        headers.forEach((h, idx) => {
          const cleanH = h.trim();
          if (cleanH.includes('/') || cleanH.includes('-')) {
            const normKey = normalizeSheetDate(cleanH);
            if (normKey) dateCols[normKey] = idx;
          }
        });

        const nameIdx = 0;
        const idIdx = dept === 'MRU' ? 3 : 1;
        const roleIdx = dept === 'MRU' ? 4 : -1;
        const emailIdx = dept === 'MRU' ? 1 : -1;

        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (!r || r.length <= nameIdx) continue;
          const name = r[nameIdx] ? r[nameIdx].trim() : '';
          if (!name || name.toLowerCase().startsWith('employee name') || name.toLowerCase().startsWith('instructor')) continue;

          const empId = idIdx !== -1 && r.length > idIdx ? r[idIdx].trim() : '';
          const role = roleIdx !== -1 && r.length > roleIdx ? r[roleIdx].trim() : 'Faculty';
          const email = emailIdx !== -1 && r.length > emailIdx ? r[emailIdx].trim() : '';

          const attMap = {};
          Object.entries(dateCols).forEach(([normD, colI]) => {
            const val = r.length > colI ? r[colI].trim() : 'Present';
            attMap[normD] = val || 'Present';
          });

          list.push({
            id: empId || name,
            name,
            role,
            email,
            department: dept,
            attendance: attMap
          });
        }
        return list;
      };

      const mruA = parseAttendanceSheet(mruAttRows, 'MRU');
      const mrvA = parseAttendanceSheet(mrvAttRows, 'MRV');
      setInstructorAttendanceList([...mruA, ...mrvA]);

      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      console.error(err);
      setError(err.message || "An error occurred while fetching Google Sheets.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  // --- RECALCULATE COMBINED MRU + MRV STUDENT ATTENDANCE ---
  useEffect(() => {
    const result = processStudentAttendanceData({
      morningHeaders,
      morningRows,
      afternoonHeaders,
      afternoonRows,
      mrvMorningRows,
      mrvAfternoonRows,
      mrvDashRows,
      targetDate: selectedDate,
      targetDept: studentDeptFilter,
      targetSection: selectedSection
    });
    setSections(result.allSections);
    setStats(result.stats);
    setSectionStats(result.sectionStats);
    setStudentDetails(result.studentDetails);
  }, [morningRows, afternoonRows, mrvMorningRows, mrvAfternoonRows, mrvDashRows, selectedDate, selectedSection, studentDeptFilter, morningHeaders, afternoonHeaders]);

  // --- INSTRUCTOR WORKLOAD COMPUTATIONS ---
  const filteredWorkload = workloadList.filter(item => {
    if (workloadDeptFilter !== 'All' && item.department !== workloadDeptFilter) return false;
    if (workloadSearch.trim()) {
      const q = workloadSearch.toLowerCase().trim();
      const matchInst = item.instructor.toLowerCase().includes(q);
      const matchSub = item.subject.toLowerCase().includes(q);
      if (!matchInst && !matchSub) return false;
    }
    return true;
  });

  const workloadSummary = {
    totalInstructors: new Set(filteredWorkload.map(w => w.instructor)).size,
    totalSubjects: new Set(filteredWorkload.map(w => w.subject)).size,
    totalLectures: filteredWorkload.reduce((sum, w) => sum + w.lectures, 0),
    totalPractices: filteredWorkload.reduce((sum, w) => sum + w.practices, 0),
    totalSessions: filteredWorkload.reduce((sum, w) => sum + (w.total || (w.lectures + w.practices)), 0)
  };

  // --- SUBJECT PROGRESS COMPUTATIONS ---
  const filteredProgress = subjectProgressList.filter(item => {
    if (progressDeptFilter !== 'All' && item.department !== progressDeptFilter) return false;
    return true;
  });

  const progressSummary = {
    totalSubjects: filteredProgress.length,
    totalCurriculumSessions: filteredProgress.reduce((sum, p) => sum + p.totalSessions, 0),
    completedSessions: filteredProgress.reduce((sum, p) => sum + p.completedSessions, 0),
    overallPct: filteredProgress.reduce((sum, p) => sum + p.totalSessions, 0) > 0
      ? (filteredProgress.reduce((sum, p) => sum + p.completedSessions, 0) / filteredProgress.reduce((sum, p) => sum + p.totalSessions, 0) * 100).toFixed(2)
      : '0.00'
  };

  // --- INSTRUCTOR ATTENDANCE COMPUTATIONS ---
  const normInstructorDate = normalizeInputDate(instructorDate);
  const filteredInstructorAttendance = instructorAttendanceList.filter(inst => {
    if (instructorDeptFilter !== 'All' && inst.department !== instructorDeptFilter) return false;
    return true;
  }).map(inst => {
    const attMap = inst.attendance || {};
    const matchedKey = Object.keys(attMap).find(k => k === normInstructorDate || k.replace(/\//g, '-') === normInstructorDate);
    const status = matchedKey ? attMap[matchedKey] : (Object.values(attMap)[0] || 'Present');
    return { ...inst, status };
  });

  const attendanceSummary = {
    totalInstructors: filteredInstructorAttendance.length,
    presentCount: filteredInstructorAttendance.filter(i => i.status === 'Present').length,
    notPresentCount: filteredInstructorAttendance.filter(i => i.status !== 'Present').length,
    statusBreakdown: filteredInstructorAttendance.reduce((acc, i) => {
      acc[i.status] = (acc[i.status] || 0) + 1;
      return acc;
    }, {})
  };

  const presentInstructors = filteredInstructorAttendance.filter(i => i.status === 'Present');
  const notPresentInstructors = filteredInstructorAttendance.filter(i => i.status !== 'Present');

  // Toggle Drawer for Instructor Attendance Record History
  const toggleInstructorDrawer = (instId) => {
    setExpandedInstructorIds(prev => {
      const next = new Set(prev);
      if (next.has(instId)) {
        next.delete(instId);
      } else {
        next.add(instId);
      }
      return next;
    });
  };

  // Interactive Toggle Attendance Status for Instructor
  const toggleAttendanceStatus = (instId) => {
    setInstructorAttendanceList(prevList => {
      return prevList.map(inst => {
        if (inst.id === instId || inst.name === instId) {
          const attMap = { ...inst.attendance };
          const matchedKey = Object.keys(attMap).find(k => k === normInstructorDate || k.replace(/\//g, '-') === normInstructorDate) || normInstructorDate;
          const currentVal = attMap[matchedKey] || 'Present';
          const newVal = currentVal === 'Present' ? 'Leave' : 'Present';
          attMap[matchedKey] = newVal;
          return { ...inst, attendance: attMap };
        }
        return inst;
      });
    });
  };

  // --- ACADEMIC CALENDAR COMPUTATIONS & STATUS BADGES ---
  const calendarRefDateObj = parseCalendarDate(normalizeInputDate(calendarRefDate)) || new Date();

  const getCalendarEventStatus = (event) => {
    const fromDate = parseCalendarDate(event.from);
    const toDate = parseCalendarDate(event.to);

    if (fromDate && toDate) {
      if (calendarRefDateObj >= fromDate && calendarRefDateObj <= toDate) return 'Active Now';
      if (calendarRefDateObj < fromDate) return 'Upcoming';
      return 'Completed';
    } else if (toDate) {
      if (calendarRefDateObj <= toDate) return 'Upcoming';
      return 'Completed';
    }
    return 'Upcoming';
  };

  const activeCalendarDataset = calendarDeptFilter === 'MRU' ? mruAcademicCalendarData : mrvAcademicCalendarData;

  const filteredCalendarData = activeCalendarDataset.filter(event => {
    if (calendarSemFilter !== 'All Semesters' && event.semester !== calendarSemFilter) return false;
    if (calendarSearch.trim()) {
      const q = calendarSearch.toLowerCase().trim();
      const matchDesc = event.description.toLowerCase().includes(q);
      const matchSem = event.semester.toLowerCase().includes(q);
      if (!matchDesc && !matchSem) return false;
    }
    return true;
  });

  const calendarEventsWithStatus = filteredCalendarData.map(e => ({
    ...e,
    status: getCalendarEventStatus(e)
  }));

  const activeStageEvent = calendarEventsWithStatus.find(e => e.status === 'Active Now') ||
    calendarEventsWithStatus.find(e => e.status === 'Upcoming') ||
    { description: 'Classwork in Progress' };

  // --- DYNAMIC "ATTENTION REQUIRED" ALERTS GENERATOR (STUDENT ATTENDANCE ONLY) ---
  const generateAttentionRequiredItems = (targetDate, targetDept) => {
    const alerts = [];

    // Compute Student Attendance stats for targetDate & targetDept
    const studentData = processStudentAttendanceData({
      morningHeaders,
      morningRows,
      afternoonHeaders,
      afternoonRows,
      mrvMorningRows,
      mrvAfternoonRows,
      mrvDashRows,
      targetDate,
      targetDept,
      targetSection: 'All Sections'
    });

    // 1. HIGH PRIORITY: Individual Students with Low Overall Attendance (< 75%)
    const allStudents = studentData.studentDetails || [];
    const lowAttStudents = allStudents.filter(s =>
      s.cumTotal > 0 && s.overallPct < ATTENTION_CONFIG.LOW_STUDENT_ATTENDANCE_THRESHOLD &&
      (targetDept === 'ALL' || s.department === targetDept)
    );

    lowAttStudents.forEach(s => {
      alerts.push({
        id: `low-student-${s.id || s.uid || s.name}`,
        priority: 1,
        priorityLabel: 'High Priority',
        type: 'low_student',
        badge: '⚠ Low Student Attendance',
        badgeClass: 'badge-absent',
        department: s.department,
        section: s.section,
        name: s.name,
        studentId: s.id || s.uid || 'N/A',
        percentage: s.overallPct,
        present: s.totalPresentSessions,
        absent: s.cumTotal - s.totalPresentSessions,
        total: s.cumTotal,
        title: `Low Attendance: ${s.name} (${s.department} | ${s.section}) — ${s.overallPct}%`,
        message: `Overall attendance is ${s.overallPct}% (${s.totalPresentSessions} Present, ${s.cumTotal - s.totalPresentSessions} Absent out of ${s.cumTotal} total sessions).`
      });
    });

    // 2. HIGH PRIORITY: Low Section Attendance (< 75%) for Morning / Afternoon sessions
    studentData.sectionStats.forEach(sec => {
      if (targetDept !== 'ALL' && sec.department !== targetDept) return;

      // Check Morning session
      if (sec.mTotal > 0 && sec.mPct < ATTENTION_CONFIG.LOW_SECTION_ATTENDANCE_THRESHOLD) {
        alerts.push({
          id: `sec-low-m-${sec.department}-${sec.section}`,
          priority: 1,
          priorityLabel: 'High Priority',
          type: 'low_section',
          badge: '⚠ Low Section Attendance',
          badgeClass: 'badge-absent',
          department: sec.department,
          section: sec.section,
          session: 'Morning',
          percentage: sec.mPct,
          present: sec.mPresent,
          absent: sec.mTotal - sec.mPresent,
          total: sec.mTotal,
          title: `Low Section Attendance: ${sec.department} | ${sec.section} (${sec.mPct}%)`,
          message: `Morning section attendance is ${sec.mPct}% (${sec.mPresent} Present, ${sec.mTotal - sec.mPresent} Absent out of ${sec.mTotal} total strength).`
        });
      }

      // Check Afternoon session
      if (sec.aTotal > 0 && sec.aPct < ATTENTION_CONFIG.LOW_SECTION_ATTENDANCE_THRESHOLD) {
        alerts.push({
          id: `sec-low-a-${sec.department}-${sec.section}`,
          priority: 1,
          priorityLabel: 'High Priority',
          type: 'low_section',
          badge: '⚠ Low Section Attendance',
          badgeClass: 'badge-absent',
          department: sec.department,
          section: sec.section,
          session: 'Afternoon',
          percentage: sec.aPct,
          present: sec.aPresent,
          absent: sec.aTotal - sec.aPresent,
          total: sec.aTotal,
          title: `Low Section Attendance: ${sec.department} | ${sec.section} (${sec.aPct}%)`,
          message: `Afternoon section attendance is ${sec.aPct}% (${sec.aPresent} Present, ${sec.aTotal - sec.aPresent} Absent out of ${sec.aTotal} total strength).`
        });
      }
    });

    // 3. HIGH PRIORITY: Section Attendance Below Other Sections (Comparison)
    const depts = targetDept === 'ALL' ? ['MRU', 'MRV'] : [targetDept];
    depts.forEach(dept => {
      const deptSections = studentData.sectionStats.filter(sec => sec.department === dept);
      if (deptSections.length <= 1) return;

      // Calculate Morning Dept Average
      const mTotPresent = deptSections.reduce((acc, s) => acc + s.mPresent, 0);
      const mTotStrength = deptSections.reduce((acc, s) => acc + s.mTotal, 0);
      const mDeptAvg = mTotStrength > 0 ? Math.round((mTotPresent / mTotStrength) * 100) : 0;

      // Calculate Afternoon Dept Average
      const aTotPresent = deptSections.reduce((acc, s) => acc + s.aPresent, 0);
      const aTotStrength = deptSections.reduce((acc, s) => acc + s.aTotal, 0);
      const aDeptAvg = aTotStrength > 0 ? Math.round((aTotPresent / aTotStrength) * 100) : 0;

      deptSections.forEach(sec => {
        // Morning Comparison
        if (sec.mTotal > 0 && mDeptAvg - sec.mPct >= ATTENTION_CONFIG.SECTION_COMPARISON_THRESHOLD) {
          const diff = mDeptAvg - sec.mPct;
          alerts.push({
            id: `sec-comp-m-${sec.department}-${sec.section}`,
            priority: 1,
            priorityLabel: 'High Priority',
            type: 'below_average_section',
            badge: '⚠ Section Attendance Below Other Sections',
            badgeClass: 'badge-absent',
            department: sec.department,
            section: sec.section,
            session: 'Morning',
            percentage: sec.mPct,
            deptAvg: mDeptAvg,
            difference: diff,
            title: `Below Dept Average: ${sec.department} | ${sec.section} (Morning)`,
            message: `Morning attendance is ${sec.mPct}%, which is ${diff}% points lower than the ${sec.department} Department Average of ${mDeptAvg}%.`
          });
        }

        // Afternoon Comparison
        if (sec.aTotal > 0 && aDeptAvg - sec.aPct >= ATTENTION_CONFIG.SECTION_COMPARISON_THRESHOLD) {
          const diff = aDeptAvg - sec.aPct;
          alerts.push({
            id: `sec-comp-a-${sec.department}-${sec.section}`,
            priority: 1,
            priorityLabel: 'High Priority',
            type: 'below_average_section',
            badge: '⚠ Section Attendance Below Other Sections',
            badgeClass: 'badge-absent',
            department: sec.department,
            section: sec.section,
            session: 'Afternoon',
            percentage: sec.aPct,
            deptAvg: aDeptAvg,
            difference: diff,
            title: `Below Dept Average: ${sec.department} | ${sec.section} (Afternoon)`,
            message: `Afternoon attendance is ${sec.aPct}%, which is ${diff}% points lower than the ${sec.department} Department Average of ${aDeptAvg}%.`
          });
        }
      });
    });

    // 4. MEDIUM PRIORITY: Students Who Missed Afternoon Session
    const missedBySec = {};
    studentData.missedAfterMorning.forEach(s => {
      if (targetDept !== 'ALL' && s.department !== targetDept) return;
      const key = `${s.department}_${s.section}`;
      if (!missedBySec[key]) {
        missedBySec[key] = { department: s.department, section: s.section, students: [] };
      }
      missedBySec[key].students.push(s);
    });

    Object.values(missedBySec).forEach(group => {
      if (group.students.length > 0) {
        alerts.push({
          id: `missed-afternoon-${group.department}-${group.section}`,
          priority: 2,
          priorityLabel: 'Medium Priority',
          type: 'missed_afternoon',
          badge: '🟡 Missed Afternoon Session',
          badgeClass: 'badge-compoff',
          department: group.department,
          section: group.section,
          count: group.students.length,
          students: group.students,
          title: `Missed Afternoon: ${group.department} | ${group.section} (${group.students.length} Students)`,
          message: `${group.students.length} student(s) attended Morning session but were absent in Afternoon on ${targetDate}.`
        });
      }
    });

    // Sort: High Priority (1) first, then Medium Priority (2)
    alerts.sort((a, b) => a.priority - b.priority || a.department.localeCompare(b.department));
    return alerts;
  };

  const attentionAlerts = generateAttentionRequiredItems(attentionDate, attentionDeptFilter);
  const attentionHighCount = attentionAlerts.filter(a => a.priority === 1).length;
  const attentionMediumCount = attentionAlerts.filter(a => a.priority === 2).length;
  const attentionTotalCount = attentionAlerts.length;

  // --- ADMIN LOGIN HANDLER (MongoDB + JWT) ---
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);

    try {
      const data = await api.login(usernameInput.trim(), passwordInput);
      if (data?.username) {
        setCurrentUsername(data.username);
        try { localStorage.setItem('hod_username', data.username); } catch (e) {}
      }
      setIsLoggedIn(true);
      setLoginError('');
    } catch (err) {
      setLoginError(err.message || 'Invalid username or password. Access restricted to authorized administrator.');
    } finally {
      setLoginLoading(false);
    }
  };

  // Check for existing valid token on app load
  useEffect(() => {
    if (api.hasToken() && !isLoggedIn) {
      // Verify token by attempting a lightweight API call
      api.getReminders()
        .then(data => {
          setIsLoggedIn(true);
          setReminders(Array.isArray(data) ? data : []);
        })
        .catch(() => {
          api.logout(); // Token expired
        });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- HANDLE LOGOUT ---
  const handleLogout = () => {
    api.logout();
    setIsLoggedIn(false);
    setReminders([]);
    setDbNotifications([]);
    setUsernameInput('');
    setPasswordInput('');
    try { localStorage.removeItem('hod_username'); } catch (e) {}
  };

  // --- PASSWORD COMPLEXITY VALIDATOR & UPDATE HANDLER ---
  const checkPassComplexity = (pass) => {
    return {
      hasMinLen: pass.length >= 8,
      hasUpper: /[A-Z]/.test(pass),
      hasLower: /[a-z]/.test(pass),
      hasNumber: /[0-9]/.test(pass)
    };
  };

  const currentComplexity = checkPassComplexity(newPassword);
  const isComplexityValid = currentComplexity.hasMinLen && currentComplexity.hasUpper && currentComplexity.hasLower && currentComplexity.hasNumber;

  const handlePasswordUpdate = async (e) => {
    e.preventDefault();
    setSettingsStatus({ type: '', message: '' });

    if (newPassword !== confirmPassword) {
      setSettingsStatus({ type: 'error', message: 'New password and confirmation password do not match.' });
      return;
    }

    if (!isComplexityValid) {
      setSettingsStatus({ type: 'error', message: 'New password does not meet all complexity requirements.' });
      return;
    }

    try {
      await api.changePassword(oldPassword, newPassword);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSettingsStatus({ type: 'success', message: 'Password updated successfully! Please use your new password for future logins.' });
    } catch (err) {
      setSettingsStatus({ type: 'error', message: err.message || 'Failed to update password.' });
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="login-overlay" data-theme={theme}>
        <form className="login-card" onSubmit={handleLogin}>
          <div className="login-logo">🎓</div>
          <h2 className="login-title">Academic ERP Portal</h2>
          <p className="login-subtitle">Administrator Authentication Required</p>

          {loginError && (
            <div className="alert-banner error" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', fontSize: '0.85rem' }}>
              ⚠️ {loginError}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              className="text-input"
              type="text"
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
              placeholder="Enter admin username"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="text-input"
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="Enter password"
              required
            />
          </div>
          <button className="btn btn-primary login-btn" type="submit" disabled={loginLoading}>
            {loginLoading ? 'Authenticating...' : 'Log In'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="app-container" data-theme={theme}>

      {/* ============================================================= */}
      {/* DELETE CONFIRMATION DIALOG */}
      {/* ============================================================= */}
      {deleteConfirmId && (
        <div className="modal-backdrop" onClick={() => setDeleteConfirmId(null)}>
          <div className="modal-content" style={{ maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ fontSize: '1.1rem', fontWeight: 800 }}>🗑 Delete Reminder?</h2>
              <button className="modal-close-btn" onClick={() => setDeleteConfirmId(null)}>✕</button>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              Are you sure you want to delete this reminder? This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button className="btn btn-primary" style={{ background: 'var(--danger)', flex: 1 }} onClick={handleDeleteReminder}>
                Yes, Delete
              </button>
              <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setDeleteConfirmId(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================= */}
      {/* ADD / EDIT REMINDER MODAL */}
      {/* ============================================================= */}
      {showReminderModal && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal-content" style={{ maxWidth: '520px', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ fontSize: '1.1rem', fontWeight: 800 }}>
                {editingReminder ? '✏️ Edit Reminder' : '+ Add Reminder'}
              </h2>
              <button className="modal-close-btn" onClick={closeModal}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
              {/* Title */}
              <div className="form-group">
                <label htmlFor="rem-title">Title <span style={{ color: 'var(--danger)' }}>*</span></label>
                <input
                  id="rem-title"
                  className="text-input"
                  type="text"
                  placeholder="e.g. Review MRV Attendance"
                  value={reminderForm.title}
                  onChange={e => setReminderForm(prev => ({ ...prev, title: e.target.value }))}
                />
                {reminderFormErrors.title && <span style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>{reminderFormErrors.title}</span>}
              </div>

              {/* Description */}
              <div className="form-group">
                <label htmlFor="rem-desc">Description / Notes</label>
                <textarea
                  id="rem-desc"
                  className="text-input"
                  rows={3}
                  style={{ resize: 'vertical', fontFamily: 'inherit' }}
                  placeholder="Optional details..."
                  value={reminderForm.description}
                  onChange={e => setReminderForm(prev => ({ ...prev, description: e.target.value }))}
                />
              </div>

              {/* Date & Time */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="form-group">
                  <label htmlFor="rem-date">Date <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input
                    id="rem-date"
                    className="date-input"
                    type="date"
                    value={reminderForm.date}
                    onChange={e => setReminderForm(prev => ({ ...prev, date: e.target.value }))}
                  />
                  {reminderFormErrors.date && <span style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>{reminderFormErrors.date}</span>}
                </div>
                <div className="form-group">
                  <label htmlFor="rem-time">Time <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input
                    id="rem-time"
                    className="date-input"
                    type="time"
                    value={reminderForm.time}
                    onChange={e => setReminderForm(prev => ({ ...prev, time: e.target.value }))}
                  />
                  {reminderFormErrors.time && <span style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>{reminderFormErrors.time}</span>}
                </div>
              </div>

              {/* Priority */}
              <div className="form-group">
                <label>Priority</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {['Low', 'Medium', 'High'].map(p => (
                    <button
                      key={p}
                      type="button"
                      className={`btn ${reminderForm.priority === p ? 'btn-primary' : 'btn-outline'}`}
                      style={{ flex: 1 }}
                      onClick={() => setReminderForm(prev => ({ ...prev, priority: p }))}
                    >
                      {priorityIcon(p)} {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notification Options */}
              <div className="form-group">
                <label>Notification Options</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.4rem' }}>
                  {[
                    { key: 'dashboardNotification', label: '🖥 Dashboard Notification' },
                    { key: 'pushNotification', label: '🔔 Mobile Push Notification' }
                  ].map(({ key, label }) => (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', fontWeight: 500 }}>
                      <input
                        type="checkbox"
                        checked={reminderForm[key]}
                        onChange={e => setReminderForm(prev => ({ ...prev, [key]: e.target.checked }))}
                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSaveReminder}>
                  {editingReminder ? '✓ Update Reminder' : '+ Save Reminder'}
                </button>
                <button className="btn btn-outline" style={{ flex: 1 }} onClick={closeModal}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Instructor Detail View Modal */}
      {selectedInstructorModal && (
        <div className="modal-backdrop" onClick={() => setSelectedInstructorModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>{selectedInstructorModal.instructor}</h2>
                <span className="badge badge-present" style={{ marginTop: '0.4rem' }}>
                  Dept: {selectedInstructorModal.department || 'MRU'}
                </span>
              </div>
              <button className="modal-close-btn" onClick={() => setSelectedInstructorModal(null)}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Assigned Subject</label>
                <div style={{ fontSize: '1rem', fontWeight: 600, marginTop: '0.2rem' }}>
                  {selectedInstructorModal.subject}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', background: 'var(--table-header-bg)', padding: '1rem', borderRadius: '12px', textAlign: 'center' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>LECTURES</span>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{selectedInstructorModal.lectures}</div>
                </div>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>PRACTICES</span>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{selectedInstructorModal.practices}</div>
                </div>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>TOTAL</span>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--primary)' }}>
                    {selectedInstructorModal.total || (selectedInstructorModal.lectures + selectedInstructorModal.practices)} SESSIONS
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Attention Required Missed Students Modal */}
      {attentionStudentModal && (
        <div className="modal-backdrop" onClick={() => setAttentionStudentModal(null)}>
          <div className="modal-content" style={{ maxWidth: '650px', maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 style={{ fontSize: '1.2rem', fontWeight: 800 }}>
                  Missed Afternoon Students — Section {attentionStudentModal.section} ({attentionStudentModal.department})
                </h2>
                <span className="badge badge-compoff" style={{ marginTop: '0.3rem' }}>
                  Total: {attentionStudentModal.students.length} Students
                </span>
              </div>
              <button className="modal-close-btn" onClick={() => setAttentionStudentModal(null)}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }}>#</th>
                      <th>Student Name</th>
                      <th>Student ID</th>
                      <th>Section</th>
                      <th>Dept</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attentionStudentModal.students.map((s, idx) => (
                      <tr key={s.id || s.name || idx}>
                        <td>{idx + 1}</td>
                        <td style={{ fontWeight: 600 }}>{s.name}</td>
                        <td><span className="badge badge-neutral">{s.id || s.uid || '-'}</span></td>
                        <td>{s.section}</td>
                        <td><span className="badge badge-present">{s.department}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setSelectedDate(attentionDate);
                  setStudentDeptFilter(attentionStudentModal.department);
                  setSelectedSection(attentionStudentModal.section);
                  setAttentionStudentModal(null);
                  setActiveModule('students');
                }}
              >
                Open in Student Attendance
              </button>
              <button className="btn btn-outline" onClick={() => setAttentionStudentModal(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Navigation Drawer Backdrop */}
      {mobileMenuOpen && (
        <div
          className="mobile-nav-backdrop"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile Navigation Drawer */}
      <aside className={`mobile-nav-drawer ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="mobile-drawer-header">
          <div className="logo-section">
            <span className="logo-icon">🎓</span>
            <span className="logo-text">Academic ERP</span>
          </div>
          <button
            className="mobile-drawer-close-btn"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation menu"
          >
            ✕
          </button>
        </div>

        <nav className="mobile-drawer-nav">
          <ul className="nav-links">
            <li>
              <a
                className={`nav-item ${activeModule === 'students' ? 'active' : ''}`}
                href="#student-attendance"
                onClick={(e) => { e.preventDefault(); setActiveModule('students'); setMobileMenuOpen(false); }}
              >
                <span>📊</span> <span>Student Attendance</span>
              </a>
            </li>
            <li>
              <a
                className={`nav-item ${activeModule === 'attention' ? 'active' : ''}`}
                href="#attention-required"
                onClick={(e) => { e.preventDefault(); setActiveModule('attention'); setMobileMenuOpen(false); }}
              >
                <span>⚠️</span> <span>Attention Required</span>
                {attentionTotalCount > 0 && (
                  <span className="bell-unread-badge nav-badge">
                    {attentionTotalCount}
                  </span>
                )}
              </a>
            </li>
            <li>
              <a
                className={`nav-item ${activeModule === 'instructors' ? 'active' : ''}`}
                href="#instructor-management"
                onClick={(e) => { e.preventDefault(); setActiveModule('instructors'); setMobileMenuOpen(false); }}
              >
                <span>👨‍🏫</span> <span>Instructor Management</span>
              </a>
            </li>
            <li>
              <a
                className={`nav-item ${activeModule === 'calendar' ? 'active' : ''}`}
                href="#academic-calendar"
                onClick={(e) => { e.preventDefault(); setActiveModule('calendar'); setMobileMenuOpen(false); }}
              >
                <span>📅</span> <span>Academic Calendar</span>
              </a>
            </li>
            <li>
              <a
                className={`nav-item ${activeModule === 'reminders' ? 'active' : ''}`}
                href="#reminders"
                onClick={(e) => { e.preventDefault(); setActiveModule('reminders'); setMobileMenuOpen(false); }}
              >
                <span>📝</span> <span>Notes &amp; Reminders</span>
                {upcomingReminders.length > 0 && (
                  <span className="bell-unread-badge nav-badge">
                    {upcomingReminders.length}
                  </span>
                )}
              </a>
            </li>
            <li>
              <a
                className={`nav-item ${activeModule === 'settings' ? 'active' : ''}`}
                href="#settings"
                onClick={(e) => { e.preventDefault(); setActiveModule('settings'); setMobileMenuOpen(false); }}
              >
                <span>⚙️</span> <span>Settings</span>
              </a>
            </li>
          </ul>
        </nav>

        <div className="mobile-drawer-footer">
          <div className="drawer-user-info">
            <span>👤 Admin:</span> <strong>{currentUsername}</strong>
          </div>
          <button
            className="drawer-theme-toggle"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? '🌞 Switch to Light Mode' : '🌙 Switch to Dark Mode'}
          </button>
          <button
            className="btn btn-outline drawer-logout-btn"
            onClick={() => { handleLogout(); setMobileMenuOpen(false); }}
          >
            🚪 Log Out
          </button>
        </div>
      </aside>

      {/* Desktop Sidebar Navigation */}
      <aside className="sidebar desktop-sidebar">
        <div className="logo-section">
          <span className="logo-icon">🎓</span>
          <span className="logo-text">Academic ERP</span>
        </div>
        <ul className="nav-links">
          <li>
            <a
              className={`nav-item ${activeModule === 'students' ? 'active' : ''}`}
              href="#student-attendance"
              onClick={(e) => { e.preventDefault(); setActiveModule('students'); }}
            >
              <span>📊</span> <span>Attendance</span>
            </a>
          </li>
          <li>
            <a
              className={`nav-item ${activeModule === 'attention' ? 'active' : ''}`}
              href="#attention-required"
              onClick={(e) => { e.preventDefault(); setActiveModule('attention'); }}
            >
              <span>⚠️</span> <span>Attention</span>
              {attentionTotalCount > 0 && (
                <span className="bell-unread-badge nav-badge">
                  {attentionTotalCount}
                </span>
              )}
            </a>
          </li>
          <li>
            <a
              className={`nav-item ${activeModule === 'instructors' ? 'active' : ''}`}
              href="#instructor-management"
              onClick={(e) => { e.preventDefault(); setActiveModule('instructors'); }}
            >
              <span>👨‍🏫</span> <span>Instructors</span>
            </a>
          </li>
          <li>
            <a
              className={`nav-item ${activeModule === 'calendar' ? 'active' : ''}`}
              href="#academic-calendar"
              onClick={(e) => { e.preventDefault(); setActiveModule('calendar'); }}
            >
              <span>📅</span> <span>Calendar</span>
            </a>
          </li>
          <li>
            <a
              className={`nav-item ${activeModule === 'reminders' ? 'active' : ''}`}
              href="#reminders"
              onClick={(e) => { e.preventDefault(); setActiveModule('reminders'); }}
            >
              <span>📝</span> <span>Reminders</span>
              {upcomingReminders.length > 0 && (
                <span className="bell-unread-badge nav-badge">
                  {upcomingReminders.length}
                </span>
              )}
            </a>
          </li>
          <li>
            <a
              className={`nav-item ${activeModule === 'settings' ? 'active' : ''}`}
              href="#settings"
              onClick={(e) => { e.preventDefault(); setActiveModule('settings'); }}
            >
              <span>⚙️</span> <span>Settings</span>
            </a>
          </li>
        </ul>
        <div className="sidebar-footer">
          <button className="btn btn-outline logout-desktop-btn" onClick={handleLogout} style={{ width: '100%' }}>
            🚪 Log Out
          </button>
        </div>
      </aside>

      {/* Main Workspace */}
      <main className="main-content">
        <header className="top-header">
          {/* Mobile Left: Hamburger + Logo */}
          <div className="mobile-header-left">
            <button
              className="hamburger-btn"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
            >
              <span className="hamburger-line"></span>
              <span className="hamburger-line"></span>
              <span className="hamburger-line"></span>
            </button>
            <div className="mobile-header-brand">
              <span className="logo-icon">🎓</span>
              <span className="logo-text">Academic ERP</span>
            </div>
          </div>

          {/* Desktop Title */}
          <h1 className="header-title desktop-header-title">
            {activeModule === 'students' && 'Student Attendance Dashboard'}
            {activeModule === 'attention' && '⚠️ Attention Required — Operational Alert Center'}
            {activeModule === 'instructors' && 'Instructor Workload, Syllabus & Attendance'}
            {activeModule === 'calendar' && 'Academic Calendar 2026-27'}
            {activeModule === 'settings' && 'Admin Settings & Security'}
            {activeModule === 'reminders' && '📝 Notes & Reminders'}
          </h1>

          {/* User Controls */}
          <div className="user-controls">
            {/* Notification Bell (Always accessible on Mobile & Desktop) */}
            <div className="bell-container" ref={bellRef}>
              <button
                className="bell-btn"
                onClick={() => { setBellOpen(prev => !prev); if (!bellOpen) markBellSeen(); }}
                aria-label="View reminders notifications"
              >
                🔔
                {unreadBellCount > 0 && (
                  <span className="bell-unread-badge">{unreadBellCount}</span>
                )}
              </button>
              {bellOpen && (
                <div className="bell-dropdown">
                  <div className="bell-dropdown-header">
                    <span>🔔 Reminders</span>
                    <button
                      onClick={() => { setActiveModule('reminders'); setBellOpen(false); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontWeight: 700, fontSize: '0.8rem' }}
                    >
                      View All
                    </button>
                  </div>
                  {bellNotifications.length === 0 ? (
                    <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      ✓ No notifications
                    </div>
                  ) : (
                    <ul className="bell-dropdown-list">
                      {bellNotifications.slice(0, 5).map(r => (
                        <li
                          key={r.id}
                          className={`bell-dropdown-item ${!r.dashboardSeenAt ? 'unread' : ''}`}
                          onClick={() => { setActiveModule('reminders'); setBellOpen(false); }}
                        >
                          <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>
                            {priorityIcon(r.priority)} {r.title}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {formatReminderDateTime(r.date, r.time)}
                          </span>
                          {r.completed && <span className="badge badge-wfh" style={{ fontSize: '0.65rem', width: 'fit-content' }}>Completed</span>}
                          {!r.completed && getOverdue(r.date, r.time) && (
                            <span className="badge badge-overdue" style={{ fontSize: '0.65rem', width: 'fit-content' }}>⚠ Overdue</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Desktop-only Quick Controls (Mobile accesses them inside drawer) */}
            <button
              className="theme-toggle desktop-theme-toggle"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label="Toggle dark mode"
            >
              {theme === 'dark' ? '🌞' : '🌙'}
            </button>
            <span className="welcome-text desktop-welcome">Welcome, {currentUsername}</span>
            <button
              className="btn btn-outline desktop-logout-btn"
              onClick={handleLogout}
            >
              Log Out
            </button>
          </div>
        </header>

        <section className="dashboard-body">
          {/* ========================================================= */}
          {/* MODULE 1: STUDENT ATTENDANCE */}
          {/* ========================================================= */}
          {activeModule === 'students' && (
            <>
              {/* Department Selector & Filters Bar */}
              <div className="filter-bar">
                <div className="filter-group">
                  <label htmlFor="dept-picker">Institution / Dept</label>
                  <select
                    id="dept-picker"
                    className="select-input"
                    value={studentDeptFilter}
                    onChange={(e) => setStudentDeptFilter(e.target.value)}
                  >
                    <option value="ALL">ALL (MRU + MRV)</option>
                    <option value="MRU">MRU Only (1st Year)</option>
                    <option value="MRV">MRV Only (2nd Year)</option>
                  </select>
                </div>

                <div className="filter-group">
                  <label htmlFor="date-picker">Attendance Date</label>
                  <input
                    id="date-picker"
                    className="date-input"
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                  />
                </div>

                <div className="filter-group">
                  <label htmlFor="section-picker">Section</label>
                  <select
                    id="section-picker"
                    className="select-input"
                    value={selectedSection}
                    onChange={(e) => setSelectedSection(e.target.value)}
                  >
                    {sections.map(sec => (
                      <option key={sec} value={sec}>{sec}</option>
                    ))}
                  </select>
                </div>

                <button className="btn btn-primary" onClick={fetchAllData} disabled={loading} style={{ alignSelf: 'flex-end', height: '42px' }}>
                  {loading ? 'Refreshing...' : '🔄 Refresh Data'}
                </button>

                {lastUpdated && (
                  <span className="last-updated-text">
                    Last updated: {lastUpdated}
                  </span>
                )}
              </div>

              {/* Loading / Error Messages */}
              {loading && (
                <div className="status-msg-container">
                  <div className="spinner"></div>
                  <p>Fetching latest attendance data from Google Sheets...</p>
                </div>
              )}

              {error && (
                <div className="status-msg-container">
                  <p className="error-text">⚠️ Error loading MRU data</p>
                  <p>{error}</p>
                  <button className="btn btn-outline" onClick={fetchAllData}>Try Again</button>
                </div>
              )}

              {mrvError && (
                <div className="alert-banner error" style={{ marginBottom: '1.5rem' }}>
                  <span>⚠️</span>
                  <span>{mrvError}</span>
                </div>
              )}

              {/* Stats Cards Grid */}
              {!loading && !error && (
                <>
                  <div className="cards-grid">
                    {/* Morning Card */}
                    <div className="stats-card card-morning">
                      <h3 className="card-title">Morning Session</h3>
                      <div className="card-stats-container">
                        <div className="stat-item">
                          <span className="stat-val val-total">{stats.morningTotal}</span>
                          <span className="stat-label">Total Strength</span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-val val-present">{stats.morningPresent}</span>
                          <span className="stat-label">Present</span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-val val-absent">{stats.morningAbsent}</span>
                          <span className="stat-label">Absent</span>
                        </div>
                      </div>
                    </div>

                    {/* Afternoon Card */}
                    <div className="stats-card card-afternoon">
                      <h3 className="card-title">Afternoon Session</h3>
                      <div className="card-stats-container">
                        <div className="stat-item">
                          <span className="stat-val val-total">{stats.afternoonTotal}</span>
                          <span className="stat-label">Total Strength</span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-val val-present">{stats.afternoonPresent}</span>
                          <span className="stat-label">Present</span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-val val-absent">{stats.afternoonAbsent}</span>
                          <span className="stat-label">Absent</span>
                        </div>
                      </div>
                    </div>

                    {/* Session Comparison Card */}
                    <div className="stats-card card-comparison">
                      <h3 className="card-title">Session Comparison</h3>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem', fontWeight: 600 }}>
                        <span>Morning Present: <span style={{ color: 'var(--success)' }}>{stats.morningPresent}</span></span>
                        <span>Afternoon Present: <span style={{ color: 'var(--success)' }}>{stats.afternoonPresent}</span></span>
                      </div>
                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                          MISSED AFTER MORNING
                        </div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--danger)', marginBottom: '0.5rem' }}>
                          {stats.missedAfterMorning.length} Student{stats.missedAfterMorning.length !== 1 ? 's' : ''}
                        </div>
                        {stats.missedAfterMorning.length > 0 && (
                          <div className="comparison-list-container">
                            <ul className="comparison-list">
                              {stats.missedAfterMorning.map((s, idx) => (
                                <li key={idx}>{s.name} ({s.section} - {s.department})</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Section-Wise Percentage Analysis Section */}
                  <div className="table-section" style={{ marginBottom: '2rem' }}>
                    <h3 className="table-title">Section-Wise Day Attendance Summary ({studentDeptFilter})</h3>
                    <div className="table-wrapper">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Section</th>
                            <th>Department</th>
                            <th>Morning Session</th>
                            <th>Afternoon Session</th>
                            <th>Overall Day Count</th>
                            <th>Overall Day Percentage</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sectionStats.map((sec, idx) => (
                            <tr key={idx}>
                              <td style={{ fontWeight: 700 }}>{sec.section}</td>
                              <td><span className="badge badge-present">{sec.department}</span></td>
                              <td>{sec.mPresent} / {sec.mTotal} ({sec.mPct}%)</td>
                              <td>{sec.aPresent} / {sec.aTotal} ({sec.aPct}%)</td>
                              <td>{sec.overallPresent} / {sec.overallTotal}</td>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                  <span style={{
                                    fontWeight: 700,
                                    minWidth: '45px',
                                    color: sec.overallPct >= 75 ? 'var(--success)' : sec.overallPct >= 50 ? 'var(--warning)' : 'var(--danger)'
                                  }}>
                                    {sec.overallPct}%
                                  </span>
                                  <div style={{ flexGrow: 1, height: '8px', background: 'var(--border)', borderRadius: '4px', overflow: 'hidden', maxWidth: '140px' }}>
                                    <div style={{
                                      height: '100%',
                                      width: `${sec.overallPct}%`,
                                      background: sec.overallPct >= 75 ? 'var(--success)' : sec.overallPct >= 50 ? 'var(--warning)' : 'var(--danger)',
                                      borderRadius: '4px'
                                    }}></div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Student Details Section with Department & Overall Attendance % */}
                  <div className="table-section">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <h3 className="table-title" style={{ margin: 0 }}>Student Records ({studentDeptFilter})</h3>
                      <span className="badge badge-present">
                        Cumulative Tracking Across Sheet Dates
                      </span>
                    </div>

                    <div className="table-wrapper">
                      {studentDetails.length === 0 ? (
                        <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                          No student records found matching the selected date and filters.
                        </p>
                      ) : (
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Student Name</th>
                              <th>ID</th>
                              <th>Section</th>
                              <th>Department</th>
                              <th>Selected Date Morning</th>
                              <th>Selected Date Afternoon</th>
                              <th>Overall Sheet Attendance %</th>
                            </tr>
                          </thead>
                          <tbody>
                            {studentDetails.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((student, idx) => (
                              <tr key={idx}>
                                <td style={{ fontWeight: 700 }}>{student.name}</td>
                                <td>{student.id || '-'}</td>
                                <td>{student.section}</td>
                                <td><span className="badge badge-present">{student.department}</span></td>
                                <td>
                                  <span className={`badge ${student.morningStatus === 'Present' ? 'badge-present' : 'badge-absent'}`}>
                                    {student.morningStatus}
                                  </span>
                                </td>
                                <td>
                                  <span className={`badge ${student.afternoonStatus === 'Present' ? 'badge-present' : 'badge-absent'}`}>
                                    {student.afternoonStatus}
                                  </span>
                                </td>
                                <td>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }} title={`${student.totalPresentSessions} / ${student.cumTotal} total sessions present`}>
                                    <span style={{
                                      fontWeight: 800,
                                      minWidth: '55px',
                                      color: student.overallPct >= 75 ? 'var(--success)' : student.overallPct >= 50 ? 'var(--warning)' : 'var(--danger)'
                                    }}>
                                      {student.overallPct}%
                                    </span>
                                    <div style={{ flexGrow: 1, height: '8px', background: 'var(--border)', borderRadius: '4px', overflow: 'hidden', maxWidth: '120px' }}>
                                      <div style={{
                                        height: '100%',
                                        width: `${Math.min(student.overallPct, 100)}%`,
                                        background: student.overallPct >= 75 ? 'var(--success)' : student.overallPct >= 50 ? 'var(--warning)' : 'var(--danger)',
                                        borderRadius: '4px'
                                      }}></div>
                                    </div>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                                      ({student.totalPresentSessions}/{student.cumTotal})
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>

                    {/* Pagination Controls */}
                    {studentDetails.length > itemsPerPage && (
                      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
                        <button
                          className="btn btn-outline"
                          onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                          disabled={currentPage === 1}
                          style={{ padding: '0.4rem 0.8rem' }}
                        >
                          Prev
                        </button>

                        {currentPage > 3 && (
                          <>
                            <button className="btn btn-outline" onClick={() => setCurrentPage(1)} style={{ padding: '0.4rem 0.8rem', minWidth: '35px' }}>1</button>
                            {currentPage > 4 && <span style={{ color: 'var(--text-muted)' }}>...</span>}
                          </>
                        )}

                        {Array.from({ length: Math.ceil(studentDetails.length / itemsPerPage) }, (_, i) => i + 1)
                          .filter(page => Math.abs(page - currentPage) <= 2)
                          .map(page => (
                            <button
                              key={page}
                              className={`btn ${currentPage === page ? 'btn-primary' : 'btn-outline'}`}
                              style={{ padding: '0.4rem 0.8rem', minWidth: '35px' }}
                              onClick={() => setCurrentPage(page)}
                            >
                              {page}
                            </button>
                          ))}

                        {currentPage < Math.ceil(studentDetails.length / itemsPerPage) - 2 && (
                          <>
                            {currentPage < Math.ceil(studentDetails.length / itemsPerPage) - 3 && <span style={{ color: 'var(--text-muted)' }}>...</span>}
                            <button
                              className="btn btn-outline"
                              onClick={() => setCurrentPage(Math.ceil(studentDetails.length / itemsPerPage))}
                              style={{ padding: '0.4rem 0.8rem', minWidth: '35px' }}
                            >
                              {Math.ceil(studentDetails.length / itemsPerPage)}
                            </button>
                          </>
                        )}

                        <button
                          className="btn btn-outline"
                          onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(studentDetails.length / itemsPerPage)))}
                          disabled={currentPage === Math.ceil(studentDetails.length / itemsPerPage)}
                          style={{ padding: '0.4rem 0.8rem' }}
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {/* ========================================================= */}
          {/* MODULE 2: ATTENTION REQUIRED */}
          {/* ========================================================= */}
          {activeModule === 'attention' && (
            <>
              {/* Filter Bar */}
              <div className="filter-bar">
                <div className="filter-group">
                  <label htmlFor="att-dept-picker">Department Filter</label>
                  <select
                    id="att-dept-picker"
                    className="select-input"
                    value={attentionDeptFilter}
                    onChange={(e) => setAttentionDeptFilter(e.target.value)}
                  >
                    <option value="ALL">ALL (MRU + MRV)</option>
                    <option value="MRU">MRU Only (1st Year)</option>
                    <option value="MRV">MRV Only (2nd Year)</option>
                  </select>
                </div>

                <div className="filter-group">
                  <label htmlFor="att-date-picker">Evaluation Date</label>
                  <input
                    id="att-date-picker"
                    className="date-input"
                    type="date"
                    value={attentionDate}
                    onChange={(e) => setAttentionDate(e.target.value)}
                  />
                </div>

                <button
                  className="btn btn-primary"
                  onClick={fetchAllData}
                  disabled={loading}
                  style={{ alignSelf: 'flex-end', height: '42px' }}
                >
                  {loading ? 'Refreshing...' : '🔄 Refresh Live Data'}
                </button>

                {lastUpdated && (
                  <span className="last-updated-text">
                    Last updated: {lastUpdated}
                  </span>
                )}
              </div>

              {/* Status / Loading / Errors */}
              {loading && (
                <div className="status-msg-container">
                  <div className="spinner"></div>
                  <p>Fetching and evaluating real-time operational indicators...</p>
                </div>
              )}

              {error && (
                <div className="alert-banner error" style={{ marginBottom: '1.5rem' }}>
                  <span>⚠️</span>
                  <span>Unable to evaluate Student Attendance alerts: {error}</span>
                </div>
              )}

              {mrvError && (
                <div className="alert-banner error" style={{ marginBottom: '1.5rem' }}>
                  <span>⚠️</span>
                  <span>Unable to evaluate MRV Attendance alerts: {mrvError}</span>
                </div>
              )}

              {!loading && (
                <>
                  {/* Summary Metric Cards (Clickable for Instant Navigation) */}
                  <div className="attention-summary-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                    <div
                      className="attention-stat-card stat-high"
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        const el = document.getElementById('high-priority-section');
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                      title="Click to jump to High Priority issues"
                    >
                      <span className="attention-stat-title">⚠ HIGH PRIORITY (Click to view)</span>
                      <span className="attention-stat-val val-high">{attentionHighCount}</span>
                    </div>

                    <div
                      className="attention-stat-card stat-medium"
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        const el = document.getElementById('medium-priority-section');
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                      title="Click to jump directly to Medium Priority section"
                    >
                      <span className="attention-stat-title">🟡 MEDIUM PRIORITY (Click to jump ↓)</span>
                      <span className="attention-stat-val val-medium">{attentionMediumCount}</span>
                    </div>

                    <div className="attention-stat-card stat-total">
                      <span className="attention-stat-title">📊 TOTAL ISSUES</span>
                      <span className="attention-stat-val val-total">{attentionTotalCount}</span>
                    </div>
                  </div>

                  {/* Empty State vs Alert Cards List */}
                  {attentionTotalCount === 0 ? (
                    <div className="no-attention-banner">
                      <div className="no-attention-icon-box">✓</div>
                      <div>
                        <h3 className="no-attention-title">NO IMMEDIATE ATTENTION REQUIRED</h3>
                        <p className="no-attention-desc">
                          No student attendance issues require immediate attention for <strong>{attentionDeptFilter}</strong> on <strong>{attentionDate}</strong>.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="attention-cards-container">
                      {/* HIGH PRIORITY SECTION */}
                      {attentionHighCount > 0 && (
                        <div id="high-priority-section" style={{ scrollMarginTop: '1rem', marginBottom: '1rem' }}>
                          <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                            <span>⚠</span> HIGH PRIORITY ISSUES ({attentionHighCount})
                          </h3>

                          {attentionAlerts.filter(a => a.priority === 1).map(alert => {
                            // 1. Low Student Attendance (Individual)
                            if (alert.type === 'low_student') {
                              return (
                                <div key={alert.id} className="attention-detail-card priority-high" style={{ marginBottom: '1rem' }}>
                                  <div className="attention-detail-header">
                                    <div className="attention-badge-row">
                                      <span className="badge badge-priority-high">⚠ High Priority</span>
                                      <span className="badge badge-absent">Low Student Attendance (&lt;30%)</span>
                                      <span className="badge badge-neutral">Dept: {alert.department}</span>
                                      <span className="badge badge-present">Section: {alert.section}</span>
                                    </div>
                                    <button
                                      className="btn-action-link"
                                      onClick={() => {
                                        setSelectedDate(attentionDate);
                                        setStudentDeptFilter(alert.department);
                                        setSelectedSection(alert.section);
                                        setActiveModule('students');
                                      }}
                                    >
                                      View in Student Attendance →
                                    </button>
                                  </div>

                                  <div className="attention-detail-body">
                                    <h4 className="attention-item-heading">
                                      👤 {alert.name} ({alert.department} | Section {alert.section}) — Attendance: <span className="text-danger">{alert.percentage}%</span>
                                    </h4>
                                    <p className="attention-item-desc">{alert.message}</p>

                                    <div className="attention-metrics-mini">
                                      <div className="mini-metric">
                                        <span className="mini-label">PRESENT</span>
                                        <span className="mini-val text-success">{alert.present}</span>
                                      </div>
                                      <div className="mini-metric">
                                        <span className="mini-label">ABSENT</span>
                                        <span className="mini-val text-danger">{alert.absent}</span>
                                      </div>
                                      <div className="mini-metric">
                                        <span className="mini-label">TOTAL SESSIONS</span>
                                        <span className="mini-val">{alert.total}</span>
                                      </div>
                                      <div className="mini-metric">
                                        <span className="mini-label">ATTENDANCE %</span>
                                        <span className="mini-val text-danger">{alert.percentage}%</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            }

                            // 2. Low Section Attendance
                            if (alert.type === 'low_section') {
                              return (
                                <div key={alert.id} className="attention-detail-card priority-high" style={{ marginBottom: '1rem' }}>
                                  <div className="attention-detail-header">
                                    <div className="attention-badge-row">
                                      <span className="badge badge-priority-high">⚠ High Priority</span>
                                      <span className="badge badge-absent">Low Section Attendance (&lt;30%)</span>
                                      <span className="badge badge-neutral">Dept: {alert.department}</span>
                                      <span className="badge badge-present">Section: {alert.section}</span>
                                      <span className="badge badge-wfh">{alert.session} Session</span>
                                    </div>
                                    <button
                                      className="btn-action-link"
                                      onClick={() => {
                                        setSelectedDate(attentionDate);
                                        setStudentDeptFilter(alert.department);
                                        setSelectedSection(alert.section);
                                        setActiveModule('students');
                                      }}
                                    >
                                      View in Student Attendance →
                                    </button>
                                  </div>

                                  <div className="attention-detail-body">
                                    <h4 className="attention-item-heading">
                                      ⚠ {alert.department} | Section {alert.section} — {alert.session} Attendance: <span className="text-danger">{alert.percentage}%</span>
                                    </h4>
                                    <p className="attention-item-desc">{alert.message}</p>

                                    <div className="attention-metrics-mini">
                                      <div className="mini-metric">
                                        <span className="mini-label">PRESENT</span>
                                        <span className="mini-val text-success">{alert.present}</span>
                                      </div>
                                      <div className="mini-metric">
                                        <span className="mini-label">ABSENT</span>
                                        <span className="mini-val text-danger">{alert.absent}</span>
                                      </div>
                                      <div className="mini-metric">
                                        <span className="mini-label">TOTAL STRENGTH</span>
                                        <span className="mini-val">{alert.total}</span>
                                      </div>
                                      <div className="mini-metric">
                                        <span className="mini-label">SECTION %</span>
                                        <span className="mini-val text-danger">{alert.percentage}%</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            }

                            // 3. Section Attendance Below Other Sections
                            if (alert.type === 'below_average_section') {
                              return (
                                <div key={alert.id} className="attention-detail-card priority-high" style={{ marginBottom: '1rem' }}>
                                  <div className="attention-detail-header">
                                    <div className="attention-badge-row">
                                      <span className="badge badge-priority-high">⚠ High Priority</span>
                                      <span className="badge badge-absent">Below Dept Average</span>
                                      <span className="badge badge-neutral">Dept: {alert.department}</span>
                                      <span className="badge badge-present">Section: {alert.section}</span>
                                      <span className="badge badge-wfh">{alert.session} Session</span>
                                    </div>
                                    <button
                                      className="btn-action-link"
                                      onClick={() => {
                                        setSelectedDate(attentionDate);
                                        setStudentDeptFilter(alert.department);
                                        setSelectedSection(alert.section);
                                        setActiveModule('students');
                                      }}
                                    >
                                      View in Student Attendance →
                                    </button>
                                  </div>

                                  <div className="attention-detail-body">
                                    <h4 className="attention-item-heading">
                                      📊 {alert.department} | Section {alert.section} — Attendance ({alert.percentage}%) is <span className="text-danger">{alert.difference}% Points Below</span> Department Average ({alert.deptAvg}%)
                                    </h4>
                                    <p className="attention-item-desc">{alert.message}</p>

                                    <div className="attention-metrics-mini">
                                      <div className="mini-metric">
                                        <span className="mini-label">SECTION ATTENDANCE</span>
                                        <span className="mini-val text-danger">{alert.percentage}%</span>
                                      </div>
                                      <div className="mini-metric">
                                        <span className="mini-label">DEPARTMENT AVERAGE</span>
                                        <span className="mini-val text-success">{alert.deptAvg}%</span>
                                      </div>
                                      <div className="mini-metric">
                                        <span className="mini-label">DIFFERENCE</span>
                                        <span className="mini-val text-danger">-{alert.difference}%</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            }

                            return null;
                          })}
                        </div>
                      )}

                      {/* MEDIUM PRIORITY SECTION */}
                      {attentionMediumCount > 0 && (
                        <div id="medium-priority-section" style={{ scrollMarginTop: '1rem', marginTop: '1.5rem' }}>
                          <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                            <span>🟡</span> MEDIUM PRIORITY ISSUES ({attentionMediumCount})
                          </h3>

                          {attentionAlerts.filter(a => a.priority === 2).map(alert => {
                            if (alert.type === 'missed_afternoon') {
                              return (
                                <div key={alert.id} className="attention-detail-card priority-medium" style={{ marginBottom: '1rem' }}>
                                  <div className="attention-detail-header">
                                    <div className="attention-badge-row">
                                      <span className="badge badge-priority-medium">🟡 Medium Priority</span>
                                      <span className="badge badge-compoff">Missed Afternoon Session</span>
                                      <span className="badge badge-neutral">Dept: {alert.department}</span>
                                      <span className="badge badge-present">Section: {alert.section}</span>
                                    </div>
                                    <button
                                      className="btn-action-link"
                                      onClick={() => {
                                        setSelectedDate(attentionDate);
                                        setStudentDeptFilter(alert.department);
                                        setSelectedSection(alert.section);
                                        setActiveModule('students');
                                      }}
                                    >
                                      View in Student Attendance →
                                    </button>
                                  </div>

                                  <div className="attention-detail-body">
                                    <h4 className="attention-item-heading">
                                      🟡 {alert.department} | Section {alert.section} — {alert.count} Student(s) attended Morning but missed Afternoon
                                    </h4>
                                    <p className="attention-item-desc">{alert.message}</p>

                                    <div className="attention-students-list">
                                      <div className="attention-list-label">Identified Students:</div>
                                      <div className="attention-chips-wrap">
                                        {alert.students.slice(0, 8).map(s => (
                                          <span key={s.id || s.name} className="student-chip">
                                            👤 {s.name} {s.id ? `(${s.id})` : ''}
                                          </span>
                                        ))}
                                        {alert.students.length > 8 && (
                                          <button
                                            className="chip-more-btn"
                                            onClick={() => setAttentionStudentModal({ section: alert.section, department: alert.department, students: alert.students })}
                                          >
                                            +{alert.students.length - 8} more (View All)
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ========================================================= */}
          {/* MODULE 3: INSTRUCTOR MANAGEMENT */}
          {/* ========================================================= */}
          {activeModule === 'instructors' && (
            <>
              {/* Sub-Tab Navigation Bar */}
              <div className="sub-tabs-container">
                <button
                  className={`sub-tab-btn ${instructorSubTab === 'workload' ? 'active' : ''}`}
                  onClick={() => setInstructorSubTab('workload')}
                >
                  💼 Workload
                </button>
                <button
                  className={`sub-tab-btn ${instructorSubTab === 'progress' ? 'active' : ''}`}
                  onClick={() => setInstructorSubTab('progress')}
                >
                  📈 Subject Progress
                </button>
                <button
                  className={`sub-tab-btn ${instructorSubTab === 'attendance' ? 'active' : ''}`}
                  onClick={() => setInstructorSubTab('attendance')}
                >
                  📅 Attendance
                </button>
              </div>

              {/* SUB-TAB 1: WORKLOAD */}
              {instructorSubTab === 'workload' && (
                <>
                  <div className="filter-bar">
                    <div className="filter-group">
                      <label htmlFor="workload-dept">Department Filter</label>
                      <select
                        id="workload-dept"
                        className="select-input"
                        value={workloadDeptFilter}
                        onChange={(e) => setWorkloadDeptFilter(e.target.value)}
                      >
                        <option value="All">All (MRU & MRV)</option>
                        <option value="MRU">MRU Only</option>
                        <option value="MRV">MRV Only</option>
                      </select>
                    </div>

                    <div className="filter-group" style={{ flexGrow: 1, maxWidth: '350px' }}>
                      <label htmlFor="workload-search">Search Instructor or Subject</label>
                      <input
                        id="workload-search"
                        className="text-input"
                        type="text"
                        placeholder="Search e.g. Vamshi or Maths..."
                        value={workloadSearch}
                        onChange={(e) => setWorkloadSearch(e.target.value)}
                      />
                    </div>

                    <button
                      className="btn btn-primary"
                      onClick={fetchAllData}
                      disabled={loading}
                      style={{ alignSelf: 'flex-end', height: '42px' }}
                    >
                      {loading ? 'Refreshing...' : '🔄 Refresh Data'}
                    </button>
                  </div>

                  <div className="cards-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                    <div className="stats-card card-morning">
                      <h3 className="card-title">Instructors</h3>
                      <span className="stat-val val-total">{workloadSummary.totalInstructors}</span>
                    </div>
                    <div className="stats-card card-afternoon">
                      <h3 className="card-title">Subjects</h3>
                      <span className="stat-val val-total">{workloadSummary.totalSubjects}</span>
                    </div>
                    <div className="stats-card card-morning">
                      <h3 className="card-title">Lectures</h3>
                      <span className="stat-val val-present">{workloadSummary.totalLectures}</span>
                    </div>
                    <div className="stats-card card-afternoon">
                      <h3 className="card-title">Practices</h3>
                      <span className="stat-val val-present">{workloadSummary.totalPractices}</span>
                    </div>
                    <div className="stats-card card-comparison">
                      <h3 className="card-title">Total Workload</h3>
                      <span className="stat-val val-absent" style={{ color: 'var(--primary)' }}>{workloadSummary.totalSessions}</span>
                    </div>
                  </div>

                  <div className="table-section">
                    <h3 className="table-title">Instructor Workload Breakdown (Live Sheet Data)</h3>
                    <div className="table-wrapper">
                      {filteredWorkload.length === 0 ? (
                        <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                          No workload records match the search and department filter.
                        </p>
                      ) : (
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Subject</th>
                              <th>Instructor Name</th>
                              <th>Department</th>
                              <th>Lectures</th>
                              <th>Practices</th>
                              <th>Total Sessions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredWorkload.map((item, idx) => (
                              <tr
                                key={idx}
                                className="clickable-row"
                                onClick={() => setSelectedInstructorModal(item)}
                              >
                                <td>{item.subject}</td>
                                <td style={{ fontWeight: 700, color: 'var(--primary)' }}>{item.instructor}</td>
                                <td><span className="badge badge-present">{item.department}</span></td>
                                <td>{item.lectures}</td>
                                <td>{item.practices}</td>
                                <td style={{ fontWeight: 800 }}>{item.total || (item.lectures + item.practices)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* SUB-TAB 2: SUBJECT PROGRESS */}
              {instructorSubTab === 'progress' && (
                <>
                  <div className="filter-bar">
                    <div className="filter-group">
                      <label htmlFor="progress-dept">Department Filter</label>
                      <select
                        id="progress-dept"
                        className="select-input"
                        value={progressDeptFilter}
                        onChange={(e) => setProgressDeptFilter(e.target.value)}
                      >
                        <option value="All">All (MRU & MRV)</option>
                        <option value="MRU">MRU Only</option>
                        <option value="MRV">MRV Only</option>
                      </select>
                    </div>

                    <button
                      className="btn btn-primary"
                      onClick={fetchAllData}
                      disabled={loading}
                      style={{ alignSelf: 'flex-end', height: '42px' }}
                    >
                      {loading ? 'Refreshing...' : '🔄 Refresh Data'}
                    </button>
                  </div>

                  <div className="cards-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                    <div className="stats-card card-morning">
                      <h3 className="card-title">Total Subjects</h3>
                      <span className="stat-val val-total">{progressSummary.totalSubjects}</span>
                    </div>
                    <div className="stats-card card-afternoon">
                      <h3 className="card-title">Curriculum Target</h3>
                      <span className="stat-val val-total">{progressSummary.totalCurriculumSessions}</span>
                    </div>
                    <div className="stats-card card-morning">
                      <h3 className="card-title">Completed Sessions</h3>
                      <span className="stat-val val-present">{progressSummary.completedSessions}</span>
                    </div>
                    <div className="stats-card card-comparison">
                      <h3 className="card-title">Overall Progress</h3>
                      <span className="stat-val val-absent" style={{ color: 'var(--success)' }}>{progressSummary.overallPct}%</span>
                    </div>
                  </div>

                  <div className="table-section">
                    <h3 className="table-title">Subject-Wise Syllabus & Progress Tracking</h3>
                    <div className="table-wrapper">
                      {filteredProgress.length === 0 ? (
                        <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                          No subject progress records found.
                        </p>
                      ) : (
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Subject</th>
                              <th>Department</th>
                              <th>Total Sessions</th>
                              <th>Completed Sessions</th>
                              <th>Average %</th>
                              <th>ProRata %</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredProgress.map((item, idx) => {
                              const pctVal = parseFloat(item.calculatedAvg || 0);
                              return (
                                <tr key={idx}>
                                  <td style={{ fontWeight: 700 }}>{item.subject}</td>
                                  <td><span className="badge badge-present">{item.department}</span></td>
                                  <td>{item.totalSessions}</td>
                                  <td style={{ fontWeight: 700, color: 'var(--success)' }}>{item.completedSessions}</td>
                                  <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                      <span style={{
                                        fontWeight: 700,
                                        minWidth: '55px',
                                        color: pctVal >= 75 ? 'var(--success)' : pctVal >= 50 ? 'var(--warning)' : 'var(--danger)'
                                      }}>
                                        {item.average}
                                      </span>
                                      <div style={{ flexGrow: 1, height: '8px', background: 'var(--border)', borderRadius: '4px', overflow: 'hidden', maxWidth: '140px' }}>
                                        <div style={{
                                          height: '100%',
                                          width: `${Math.min(pctVal, 100)}%`,
                                          background: pctVal >= 75 ? 'var(--success)' : pctVal >= 50 ? 'var(--warning)' : 'var(--danger)',
                                          borderRadius: '4px'
                                        }}></div>
                                      </div>
                                    </div>
                                  </td>
                                  <td style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{item.proRata ? `${item.proRata}%` : '-'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* SUB-TAB 3: ATTENDANCE */}
              {instructorSubTab === 'attendance' && (
                <>
                  <div className="filter-bar">
                    <div className="filter-group">
                      <label htmlFor="inst-date">Attendance Date</label>
                      <input
                        id="inst-date"
                        className="date-input"
                        type="date"
                        value={instructorDate}
                        onChange={(e) => setInstructorDate(e.target.value)}
                      />
                    </div>

                    <div className="filter-group">
                      <label htmlFor="inst-dept">Department Filter</label>
                      <select
                        id="inst-dept"
                        className="select-input"
                        value={instructorDeptFilter}
                        onChange={(e) => setInstructorDeptFilter(e.target.value)}
                      >
                        <option value="All">All (MRU & MRV)</option>
                        <option value="MRU">MRU Only</option>
                        <option value="MRV">MRV Only</option>
                      </select>
                    </div>

                    <button
                      className="btn btn-primary"
                      onClick={fetchAllData}
                      disabled={loading}
                      style={{ alignSelf: 'flex-end', height: '42px' }}
                    >
                      {loading ? 'Refreshing...' : '🔄 Refresh Data'}
                    </button>
                  </div>

                  <div className="cards-grid">
                    <div className="stats-card card-morning">
                      <h3 className="card-title">Total Instructors</h3>
                      <span className="stat-val val-total">{attendanceSummary.totalInstructors}</span>
                    </div>

                    <div className="stats-card card-afternoon">
                      <h3 className="card-title">Present Today</h3>
                      <span className="stat-val val-present">{attendanceSummary.presentCount}</span>
                    </div>

                    <div className="stats-card card-comparison">
                      <h3 className="card-title">Not Present Today</h3>
                      <span className="stat-val val-absent">{attendanceSummary.notPresentCount}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap', alignItems: 'center', background: 'var(--card-bg)', padding: '1rem 1.5rem', borderRadius: '16px', border: '1px solid var(--card-border)' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Status Breakdown:</span>
                    {Object.entries(attendanceSummary.statusBreakdown).map(([st, cnt]) => (
                      <span key={st} className={`badge ${st === 'Present' ? 'badge-present' :
                        st === 'WFH' ? 'badge-wfh' :
                          st === 'CompOff' ? 'badge-compoff' : 'badge-leave'
                        }`}>
                        {st}: {cnt}
                      </span>
                    ))}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
                    <div className="stats-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 className="card-title" style={{ color: 'var(--success)', margin: 0 }}>
                          PRESENT TODAY ({presentInstructors.length})
                        </h3>
                      </div>
                      <ul className="instructor-card-list">
                        {presentInstructors.length === 0 ? (
                          <li style={{ color: 'var(--text-muted)', padding: '0.5rem 0' }}>No instructors present today</li>
                        ) : (
                          presentInstructors.map(inst => {
                            const instKey = inst.id || inst.name;
                            const isExpanded = expandedInstructorIds.has(instKey);
                            return (
                              <li key={instKey} className="instructor-card-item">
                                <div className="instructor-card-main">
                                  <div className="instructor-info">
                                    <span className="status-dot-present"></span>
                                    <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{inst.name}</span>
                                    <span className="badge badge-present" style={{ fontSize: '0.7rem' }}>{inst.department}</span>
                                  </div>
                                  <div className="instructor-status-arrow-group">
                                    <span
                                      className="badge badge-present"
                                      style={{ cursor: 'pointer' }}
                                      onClick={() => toggleAttendanceStatus(instKey)}
                                      title="Click to toggle status"
                                    >
                                      ✓ Present
                                    </span>
                                    <button
                                      className={`expand-arrow-btn ${isExpanded ? 'open' : ''}`}
                                      onClick={() => toggleInstructorDrawer(instKey)}
                                      title="Toggle attendance record history"
                                    >
                                      ▼
                                    </button>
                                  </div>
                                </div>

                                {isExpanded && (
                                  <div className="attendance-history-drawer">
                                    <div className="history-drawer-title">📅 Complete Attendance Record History ({inst.name})</div>
                                    <div className="history-grid">
                                      {Object.entries(inst.attendance || {}).map(([dStr, stVal]) => (
                                        <div key={dStr} className="history-date-chip">
                                          <span className="date-lbl">{dStr}</span>
                                          <span className={`badge ${stVal === 'Present' ? 'badge-present' :
                                            stVal === 'WFH' ? 'badge-wfh' :
                                              stVal === 'CompOff' ? 'badge-compoff' : 'badge-leave'
                                            }`} style={{ fontSize: '0.65rem' }}>
                                            {stVal}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </li>
                            );
                          })
                        )}
                      </ul>
                    </div>

                    <div className="stats-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 className="card-title" style={{ color: 'var(--danger)', margin: 0 }}>
                          NOT PRESENT TODAY ({notPresentInstructors.length})
                        </h3>
                      </div>
                      <ul className="instructor-card-list">
                        {notPresentInstructors.length === 0 ? (
                          <li style={{ color: 'var(--text-muted)', padding: '0.5rem 0' }}>All instructors are present today</li>
                        ) : (
                          notPresentInstructors.map(inst => {
                            const instKey = inst.id || inst.name;
                            const isExpanded = expandedInstructorIds.has(instKey);
                            return (
                              <li key={instKey} className="instructor-card-item">
                                <div className="instructor-card-main">
                                  <div className="instructor-info">
                                    <span className="status-dot-absent"></span>
                                    <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{inst.name}</span>
                                    <span className="badge badge-present" style={{ fontSize: '0.7rem' }}>{inst.department}</span>
                                  </div>
                                  <div className="instructor-status-arrow-group">
                                    <span
                                      className={`badge ${inst.status === 'WFH' ? 'badge-wfh' : inst.status === 'CompOff' ? 'badge-compoff' : 'badge-leave'}`}
                                      style={{ cursor: 'pointer' }}
                                      onClick={() => toggleAttendanceStatus(instKey)}
                                      title="Click to toggle status"
                                    >
                                      {inst.status}
                                    </span>
                                    <button
                                      className={`expand-arrow-btn ${isExpanded ? 'open' : ''}`}
                                      onClick={() => toggleInstructorDrawer(instKey)}
                                      title="Toggle attendance record history"
                                    >
                                      ▼
                                    </button>
                                  </div>
                                </div>

                                {isExpanded && (
                                  <div className="attendance-history-drawer">
                                    <div className="history-drawer-title">📅 Complete Attendance Record History ({inst.name})</div>
                                    <div className="history-grid">
                                      {Object.entries(inst.attendance || {}).map(([dStr, stVal]) => (
                                        <div key={dStr} className="history-date-chip">
                                          <span className="date-lbl">{dStr}</span>
                                          <span className={`badge ${stVal === 'Present' ? 'badge-present' :
                                            stVal === 'WFH' ? 'badge-wfh' :
                                              stVal === 'CompOff' ? 'badge-compoff' : 'badge-leave'
                                            }`} style={{ fontSize: '0.65rem' }}>
                                            {stVal}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </li>
                            );
                          })
                        )}
                      </ul>
                    </div>
                  </div>

                  <div className="table-section">
                    <h3 className="table-title">Instructor Attendance Records</h3>
                    <div className="table-wrapper">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Employee Name</th>
                            <th>Employee ID</th>
                            <th>Role</th>
                            <th>Department</th>
                            <th>Attendance Status</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredInstructorAttendance.map(inst => {
                            const instKey = inst.id || inst.name;
                            const isExpanded = expandedInstructorIds.has(instKey);
                            return (
                              <React.Fragment key={instKey}>
                                <tr>
                                  <td style={{ fontWeight: 700 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                      <span className={inst.status === 'Present' ? 'status-dot-present' : 'status-dot-absent'}></span>
                                      {inst.name}
                                    </div>
                                  </td>
                                  <td>{inst.id || '-'}</td>
                                  <td>{inst.role}</td>
                                  <td><span className="badge badge-present">{inst.department}</span></td>
                                  <td>
                                    <span
                                      className={`badge ${inst.status === 'Present' ? 'badge-present' :
                                        inst.status === 'WFH' ? 'badge-wfh' :
                                          inst.status === 'CompOff' ? 'badge-compoff' : 'badge-leave'
                                        }`}
                                      style={{ cursor: 'pointer' }}
                                      onClick={() => toggleAttendanceStatus(instKey)}
                                      title="Click to toggle status"
                                    >
                                      {inst.status}
                                    </span>
                                  </td>
                                  <td>
                                    <button
                                      className={`expand-arrow-btn ${isExpanded ? 'open' : ''}`}
                                      onClick={() => toggleInstructorDrawer(instKey)}
                                      title="Toggle attendance history record"
                                    >
                                      ▼
                                    </button>
                                  </td>
                                </tr>
                                {isExpanded && (
                                  <tr>
                                    <td colSpan="6" style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem' }}>
                                      <div className="history-drawer-title">📅 Full Date-by-Date Attendance Timeline ({inst.name})</div>
                                      <div className="history-grid">
                                        {Object.entries(inst.attendance || {}).map(([dStr, stVal]) => (
                                          <div key={dStr} className="history-date-chip">
                                            <span className="date-lbl">{dStr}</span>
                                            <span className={`badge ${stVal === 'Present' ? 'badge-present' :
                                              stVal === 'WFH' ? 'badge-wfh' :
                                                stVal === 'CompOff' ? 'badge-compoff' : 'badge-leave'
                                              }`} style={{ fontSize: '0.65rem' }}>
                                              {stVal}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* ========================================================= */}
          {/* MODULE 3: ACADEMIC CALENDAR */}
          {/* ========================================================= */}
          {activeModule === 'calendar' && (
            <>
              {/* Calendar Filter & Search Bar */}
              <div className="filter-bar">
                <div className="filter-group">
                  <label htmlFor="calendar-dept">University / Institution</label>
                  <select
                    id="calendar-dept"
                    className="select-input"
                    value={calendarDeptFilter}
                    onChange={(e) => setCalendarDeptFilter(e.target.value)}
                  >
                    <option value="MRU">MRU Calendar (1st Year Students)</option>
                    <option value="MRV">MRV Calendar (2nd Year Students)</option>
                  </select>
                </div>

                <div className="filter-group">
                  <label htmlFor="calendar-sem">Semester Filter</label>
                  <select
                    id="calendar-sem"
                    className="select-input"
                    value={calendarSemFilter}
                    onChange={(e) => setCalendarSemFilter(e.target.value)}
                  >
                    <option value="All Semesters">All Semesters</option>
                    {calendarDeptFilter === 'MRU' ? (
                      <>
                        <option value="I Year I Semester">I Year I Semester</option>
                        <option value="I Year II Semester">I Year II Semester</option>
                      </>
                    ) : (
                      <>
                        <option value="II Year I Semester">II Year I Semester</option>
                        <option value="II Year II Semester">II Year II Semester</option>
                      </>
                    )}
                  </select>
                </div>

                <div className="filter-group">
                  <label htmlFor="calendar-ref-date">Reference Status Date</label>
                  <input
                    id="calendar-ref-date"
                    className="date-input"
                    type="date"
                    value={calendarRefDate}
                    onChange={(e) => setCalendarRefDate(e.target.value)}
                  />
                </div>

                <div className="filter-group" style={{ flexGrow: 1, maxWidth: '300px' }}>
                  <label htmlFor="calendar-search">Search Event Description</label>
                  <input
                    id="calendar-search"
                    className="text-input"
                    type="text"
                    placeholder="Search e.g. Mid Term or Practical..."
                    value={calendarSearch}
                    onChange={(e) => setCalendarSearch(e.target.value)}
                  />
                </div>
              </div>

              {/* Summary Cards */}
              <div className="cards-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                <div className="stats-card card-morning">
                  <h3 className="card-title">Total Calendar Events</h3>
                  <span className="stat-val val-total">{calendarEventsWithStatus.length}</span>
                </div>
                <div className="stats-card card-afternoon">
                  <h3 className="card-title">Active Stage Now</h3>
                  <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--success)', marginTop: '0.4rem' }}>
                    {activeStageEvent.description}
                  </div>
                </div>
                <div className="stats-card card-comparison">
                  <h3 className="card-title">Academic Year</h3>
                  <span className="stat-val val-total" style={{ fontSize: '1.25rem', color: 'var(--primary)' }}>2026-27</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    {calendarDeptFilter === 'MRU' ? '1st Year Students (B.Tech All Branches)' : '2nd Year Students (Batch 2025-26)'}
                  </span>
                </div>
              </div>

              {/* Render Academic Calendar Tables */}
              {(calendarDeptFilter === 'MRU' ? ['I Year I Semester', 'I Year II Semester'] : ['II Year I Semester', 'II Year II Semester']).map(semName => {
                if (calendarSemFilter !== 'All Semesters' && calendarSemFilter !== semName) return null;
                const semEvents = calendarEventsWithStatus.filter(e => e.semester === semName);

                return (
                  <div className="table-section" key={semName} style={{ marginBottom: '2rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                      <div>
                        <h3 className="table-title" style={{ margin: 0, color: 'var(--primary)', fontSize: '1.2rem', fontWeight: 800 }}>
                          {semName} ({calendarDeptFilter})
                        </h3>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                          Academic Year 2026-27 | {calendarDeptFilter === 'MRU' ? '1st Year Students (B.Tech All Branches)' : '2nd Year Students (Admitted Batch 2025-26)'}
                        </span>
                      </div>
                      <span className="badge badge-present">{semEvents.length} Events</span>
                    </div>

                    <div className="table-wrapper">
                      {semEvents.length === 0 ? (
                        <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                          No events found matching search query.
                        </p>
                      ) : (
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th style={{ width: '60px' }}>S.No</th>
                              <th>Description</th>
                              <th>From Date</th>
                              <th>To Date / Period</th>
                              <th>Duration</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {semEvents.map(event => (
                              <tr key={event.sno + event.description} style={{
                                background: event.status === 'Active Now' ? 'rgba(16, 185, 129, 0.08)' : 'transparent'
                              }}>
                                <td style={{ fontWeight: 700 }}>{event.sno}</td>
                                <td style={{ fontWeight: 700, color: event.status === 'Active Now' ? 'var(--success)' : 'var(--text-main)' }}>
                                  {event.description}
                                </td>
                                <td>{event.from || '-'}</td>
                                <td style={{ fontWeight: 600 }}>{event.to}</td>
                                <td>{event.duration}</td>
                                <td>
                                  <span className={`badge ${event.status === 'Active Now' ? 'badge-present' :
                                    event.status === 'Upcoming' ? 'badge-compoff' : 'badge-wfh'
                                    }`}>
                                    {event.status === 'Active Now' ? '🟢 Active Now' :
                                      event.status === 'Upcoming' ? '🟡 Upcoming' : '⚪ Completed'}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* ========================================================= */}
          {/* MODULE 4: SETTINGS & ADMIN PASSWORD MANAGEMENT */}
          {/* ========================================================= */}
          {activeModule === 'settings' && (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '1rem' }}>
              <div className="settings-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                  <span style={{ fontSize: '1.75rem' }}>🔒</span>
                  <div>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0 }}>Admin Password Management</h2>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>Update your portal administrator security credentials directly</p>
                  </div>
                </div>

                {settingsStatus.message && (
                  <div className={`alert-banner ${settingsStatus.type}`}>
                    <span>{settingsStatus.type === 'success' ? '✅' : '⚠️'}</span>
                    <span>{settingsStatus.message}</span>
                  </div>
                )}

                <form onSubmit={handlePasswordUpdate} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <div className="form-group">
                    <label style={{ fontSize: '0.85rem', fontWeight: 700 }}>Administrator Username</label>
                    <input
                      className="text-input"
                      type="text"
                      value={currentUsername}
                      disabled
                      style={{ opacity: 0.7, cursor: 'not-allowed', background: 'rgba(0,0,0,0.1)' }}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="old-pass" style={{ fontSize: '0.85rem', fontWeight: 700 }}>Current Password</label>
                    <input
                      id="old-pass"
                      className="text-input"
                      type="password"
                      placeholder="Enter current admin password"
                      value={oldPassword}
                      onChange={(e) => setOldPassword(e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="new-pass" style={{ fontSize: '0.85rem', fontWeight: 700 }}>New Password</label>
                    <input
                      id="new-pass"
                      className="text-input"
                      type="password"
                      placeholder="Enter new strong password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                    />

                    {/* Password Complexity Checklist Indicator */}
                    <div className="criteria-list">
                      <div className={`criteria-item ${currentComplexity.hasMinLen ? 'met' : 'unmet'}`}>
                        <span>{currentComplexity.hasMinLen ? '✓' : '○'}</span>
                        <span>At least 8 characters long</span>
                      </div>
                      <div className={`criteria-item ${currentComplexity.hasUpper ? 'met' : 'unmet'}`}>
                        <span>{currentComplexity.hasUpper ? '✓' : '○'}</span>
                        <span>Contains uppercase letter (A-Z)</span>
                      </div>
                      <div className={`criteria-item ${currentComplexity.hasLower ? 'met' : 'unmet'}`}>
                        <span>{currentComplexity.hasLower ? '✓' : '○'}</span>
                        <span>Contains lowercase letter (a-z)</span>
                      </div>
                      <div className={`criteria-item ${currentComplexity.hasNumber ? 'met' : 'unmet'}`}>
                        <span>{currentComplexity.hasNumber ? '✓' : '○'}</span>
                        <span>Contains number (0-9)</span>
                      </div>
                    </div>
                  </div>

                  <div className="form-group">
                    <label htmlFor="confirm-pass" style={{ fontSize: '0.85rem', fontWeight: 700 }}>Confirm New Password</label>
                    <input
                      id="confirm-pass"
                      className="text-input"
                      type="password"
                      placeholder="Re-enter new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                    />
                  </div>

                  <button
                    className="btn btn-primary"
                    type="submit"
                    style={{ marginTop: '0.5rem', height: '44px', fontWeight: 700 }}
                  >
                    Save New Password
                  </button>
                </form>
              </div>

              </div>
          )}

          {/* ============================================================= */}
          {/* MODULE 5: NOTES & REMINDERS */}
          {/* ============================================================= */}
          {activeModule === 'reminders' && (
            <>
              {/* Overview Widgets Row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>

                {/* Upcoming Reminders Widget */}
                <div className="reminders-widget-container">
                  <div className="reminders-widget-header">
                    <h3 className="reminders-widget-title">📌 Upcoming Reminders</h3>
                    <span className="badge badge-present">{upcomingReminders.length} Pending</span>
                  </div>
                  {upcomingReminders.length === 0 ? (
                    <div className="no-attention-box" style={{ fontSize: '0.85rem' }}>✓ No upcoming reminders</div>
                  ) : (
                    upcomingReminders.slice(0, 3).map(r => {
                      const overdue = getOverdue(r.date, r.time);
                      return (
                        <div key={r.id} className="reminder-widget-item">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                            <span>{priorityIcon(r.priority)}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 700, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>{formatReminderDateTime(r.date, r.time)}</div>
                            </div>
                          </div>
                          {overdue ? (
                            <span className="badge badge-overdue" style={{ fontSize: '0.7rem', whiteSpace: 'nowrap' }}>⚠ Overdue</span>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                  {upcomingReminders.length > 3 && (
                    <div style={{ textAlign: 'center', marginTop: '0.5rem' }}>
                      <button
                        className="btn btn-outline"
                        style={{ fontSize: '0.8rem', padding: '0.35rem 1rem' }}
                        onClick={() => setReminderFilter('Upcoming')}
                      >
                        View All ({upcomingReminders.length})
                      </button>
                    </div>
                  )}
                </div>

                {/* Today's Reminders Widget */}
                <div className="reminders-widget-container">
                  <div className="reminders-widget-header">
                    <h3 className="reminders-widget-title">📅 Today's Reminders</h3>
                    <span className="badge badge-present">{todaysReminders.length} Today</span>
                  </div>
                  {todaysReminders.length === 0 ? (
                    <div className="no-attention-box" style={{ fontSize: '0.85rem' }}>No reminders scheduled for today.</div>
                  ) : (
                    todaysReminders.map(r => (
                      <div key={r.id} className="reminder-widget-item">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                          <span>{priorityIcon(r.priority)}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {formatTime12h(r.time)} — {r.title}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Page Header + Add Button */}
              <div className="reminders-page-header">
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {['Upcoming', 'Completed', 'All'].map(f => (
                    <button
                      key={f}
                      className={`sub-tab-btn ${reminderFilter === f ? 'active' : ''}`}
                      onClick={() => setReminderFilter(f)}
                    >
                      {f === 'Upcoming' ? `📌 Upcoming (${upcomingReminders.length})` :
                       f === 'Completed' ? `✓ Completed (${completedReminders.length})` :
                       `📋 All (${reminders.length})`}
                    </button>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  {/* Push Notification Toggle */}
                  {pushPermission === 'granted' ? (
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="badge badge-present" style={{ padding: '0.45rem 0.85rem', fontSize: '0.8rem' }}>🔔 Notifications Enabled</span>
                      <button
                        className="btn btn-outline"
                        onClick={() => showAppNotification('🔔 Test Alert', 'Notifications and sound alerts are working smoothly on your mobile device!')}
                        style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
                        title="Send a quick test notification to check device alerts"
                      >
                        ⚡ Send Test Alert
                      </button>
                    </div>
                  ) : pushPermission === 'denied' ? (
                    <span className="badge badge-absent" style={{ padding: '0.5rem 0.9rem', fontSize: '0.8rem' }}>🔕 Notifications Blocked — Enable in browser settings</span>
                  ) : pushPermission === 'unsupported' ? (
                    <span className="badge badge-compoff" style={{ padding: '0.5rem 0.9rem', fontSize: '0.8rem' }}>🔕 Push not supported</span>
                  ) : (
                    <button className="btn btn-outline" onClick={enablePushNotifications} style={{ fontSize: '0.85rem' }}>
                      🔔 Enable Mobile Notifications
                    </button>
                  )}
                  <button className="btn btn-primary" onClick={openAddModal} style={{ fontWeight: 700 }}>
                    + Add Reminder
                  </button>
                </div>
              </div>

              {/* Reminders Cards Grid */}
              {displayedReminders.length === 0 ? (
                <div className="no-attention-box" style={{ marginTop: '1rem' }}>
                  ✓ No reminders found under &ldquo;{reminderFilter}&rdquo;. Click &ldquo;+ Add Reminder&rdquo; to create one.
                </div>
              ) : (
                <div className="reminders-grid">
                  {displayedReminders.map(r => {
                    const reminderKey = r._id || r.id;
                    const overdue = !r.completed ? getOverdue(r.date, r.time) : null;
                    return (
                      <div key={reminderKey} className={`reminder-card ${r.completed ? 'completed' : ''}`}>
                        {/* Top Row: Priority + Title + Status */}
                        <div className="reminder-card-top">
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
                              <span className={`badge ${priorityBadgeClass(r.priority)}`} style={{ fontSize: '0.72rem' }}>
                                {priorityIcon(r.priority)} {r.priority}
                              </span>
                              {r.completed && <span className="badge badge-wfh" style={{ fontSize: '0.72rem' }}>✓ Completed</span>}
                              {overdue && (
                                <span className="badge badge-overdue" style={{ fontSize: '0.72rem' }}>⚠ Overdue — {overdue}</span>
                              )}
                            </div>
                            <h4 className="reminder-card-title" style={{ textDecoration: r.completed ? 'line-through' : 'none' }}>
                              {r.title}
                            </h4>
                          </div>
                        </div>

                        {/* Description */}
                        {r.description && (
                          <p className="reminder-card-desc">{r.description}</p>
                        )}

                        {/* Date & Time */}
                        <div className="reminder-card-meta">
                          <span>📅 {formatReminderDateTime(r.date, r.time)}</span>
                        </div>

                        {/* Notification badges */}
                        <div className="reminder-card-notifications">
                          {r.dashboardNotification && (
                            <span className="badge badge-present" style={{ fontSize: '0.7rem' }}>🖥 Dashboard{r.dashboardSeenAt ? ' ✓' : ''}</span>
                          )}
                          {r.pushNotification && (
                            <span className="badge badge-compoff" style={{ fontSize: '0.7rem' }}>🔔 Push{r.pushSentAt ? ' ✓' : ''}</span>
                          )}
                        </div>

                        {/* Action Buttons */}
                        <div className="reminder-card-actions">
                          <button
                            className={`btn ${r.completed ? 'btn-outline' : 'btn-primary'}`}
                            style={{ flex: 1, fontSize: '0.8rem', padding: '0.45rem 0.6rem' }}
                            onClick={() => toggleReminderComplete(reminderKey)}
                          >
                            {r.completed ? '↩ Mark Pending' : '✓ Mark Complete'}
                          </button>
                          <button
                            className="btn btn-outline"
                            style={{ fontSize: '0.8rem', padding: '0.45rem 0.75rem' }}
                            onClick={() => openEditModal(r)}
                            title="Edit reminder"
                          >
                            ✏️
                          </button>
                          <button
                            className="btn btn-outline"
                            style={{ fontSize: '0.8rem', padding: '0.45rem 0.75rem', color: 'var(--danger)', borderColor: 'var(--danger)' }}
                            onClick={() => confirmDeleteReminder(reminderKey)}
                            title="Delete reminder"
                          >
                            🗑
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
