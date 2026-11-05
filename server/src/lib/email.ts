import nodemailer from 'nodemailer';
import { config } from './config.js';
import db, { uuid } from '../db/index.js';

let transporter: nodemailer.Transporter | null = null;

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function getTransporter(): nodemailer.Transporter | null {
  if (!config.emailEnabled) return null;
  if (transporter) return transporter;
  if (!config.smtp.host) return null;
  try {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
    return transporter;
  } catch (e: any) {
    console.error('[Email] Failed to create transporter:', e.message);
    return null;
  }
}

export function isEmailConfigured(): boolean {
  return config.emailEnabled;
}

export async function sendEmail(to: string, subject: string, html: string, text?: string): Promise<boolean> {
  const t = getTransporter();
  if (!t) return false;
  try {
    await t.sendMail({ from: config.smtp.from, to, subject, html, text: text ?? html.replace(/<[^>]*>/g, '') });
    return true;
  } catch (e: any) {
    console.error(`[Email] Failed to send to ${to}:`, e.message);
    return false;
  }
}

async function logEmail(recipientId: string | null, recipientEmail: string, subject: string, status: string, errorMessage?: string) {
  try {
    await db.prepare('INSERT INTO email_logs (id, recipient_id, recipient_email, subject, status, error_message) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uuid(), recipientId, recipientEmail, subject, status, errorMessage ?? null);
  } catch (e: any) {
    console.error('[Email] Failed to log email:', e.message);
  }
}

export async function sendWelcomeEmail(user: { id: string; email: string; firstName: string; lastName: string }) {
  if (!isEmailConfigured()) return;
  const subject = 'Welcome to Employee Work Tracker';
  const base = process.env.APP_URL ?? 'http://localhost:42780';
  const html = `<h2>Welcome, ${escapeHtml(user.firstName)} ${escapeHtml(user.lastName)}!</h2><p>Your account has been created. You can log in at <a href="${base}/login">${base}/login</a>.</p>`;
  const ok = await sendEmail(user.email, subject, html);
  await logEmail(user.id, user.email, subject, ok ? 'sent' : 'failed');
}

export async function sendPasswordResetEmail(to: string, resetToken: string): Promise<boolean> {
  if (!isEmailConfigured()) return false;
  const base = process.env.APP_URL ?? 'http://localhost:42780';
  const resetLink = `${base}/reset-password?token=${resetToken}`;
  const subject = 'Password Reset Request';
  const html = `<h2>Password Reset</h2><p>You requested a password reset. Click the link below to set a new password:</p><p><a href="${resetLink}">${resetLink}</a></p><p>If you did not request this, you can safely ignore this email.</p>`;
  const ok = await sendEmail(to, subject, html);
  await logEmail(null, to, subject, ok ? 'sent' : 'failed');
  return ok;
}

export async function sendPasswordResetEmailToUser(user: { id: string; email: string }, resetLink: string) {
  if (!isEmailConfigured()) return;
  const subject = 'Password Reset Request';
  const html = `<h2>Password Reset</h2><p>You requested a password reset. Click the link below to set a new password:</p><p><a href="${resetLink}">${resetLink}</a></p><p>If you did not request this, you can safely ignore this email.</p>`;
  const ok = await sendEmail(user.email, subject, html);
  await logEmail(user.id, user.email, subject, ok ? 'sent' : 'failed');
}

export async function sendLeaveNotification(leave: { id: string; type: string; startDate: string; endDate: string; reason?: string }, action: 'submitted' | 'approved' | 'rejected', recipient: { id: string; email: string; firstName: string; lastName: string }) {
  if (!isEmailConfigured()) return;
  const subject = `Leave Request ${action.charAt(0).toUpperCase() + action.slice(1)}`;
  const html = `<h2>Leave ${action.charAt(0).toUpperCase() + action.slice(1)}</h2><p>Hi ${escapeHtml(recipient.firstName)},</p><p>Your ${escapeHtml(leave.type)} leave (${escapeHtml(leave.startDate)} to ${escapeHtml(leave.endDate)}) has been <strong>${action}</strong>.${leave.reason ? `<br>Reason: ${escapeHtml(leave.reason)}` : ''}</p>`;
  const ok = await sendEmail(recipient.email, subject, html);
  await logEmail(recipient.id, recipient.email, subject, ok ? 'sent' : 'failed');
}

export async function sendTaskAssignment(task: { id: string; title: string }, assignee: { id: string; email: string; firstName: string; lastName: string }) {
  if (!isEmailConfigured()) return;
  const base = process.env.APP_URL ?? 'http://localhost:42780';
  const subject = 'New Task Assigned';
  const html = `<h2>Task Assigned</h2><p>Hi ${escapeHtml(assignee.firstName)},</p><p>You have been assigned a new task: <strong>${escapeHtml(task.title)}</strong>.</p><p><a href="${base}/tasks/${task.id}">View Task</a></p>`;
  const ok = await sendEmail(assignee.email, subject, html);
  await logEmail(assignee.id, assignee.email, subject, ok ? 'sent' : 'failed');
}

export async function sendDocumentReady(document: { id: string; docType: string; docNumber?: string }, requester: { id: string; email: string; firstName: string; lastName: string }) {
  if (!isEmailConfigured()) return;
  const base = process.env.APP_URL ?? 'http://localhost:42780';
  const subject = 'Document Ready for Download';
  const html = `<h2>Document Ready</h2><p>Hi ${escapeHtml(requester.firstName)},</p><p>Your ${escapeHtml(document.docType.replace(/_/g, ' '))} ${document.docNumber ? `(${escapeHtml(document.docNumber)})` : ''} is ready to download.</p><p><a href="${base}/documents">View Documents</a></p>`;
  const ok = await sendEmail(requester.email, subject, html);
  await logEmail(requester.id, requester.email, subject, ok ? 'sent' : 'failed');
}

export async function sendAuditAlert(alert: { type: string; message: string; recipient: { id: string; email: string; firstName: string } }) {
  if (!isEmailConfigured()) return;
  const subject = `Security Alert: ${alert.type}`;
  const html = `<h2>Security Alert</h2><p>Hi ${escapeHtml(alert.recipient.firstName)},</p><p>${escapeHtml(alert.message)}</p>`;
  const ok = await sendEmail(alert.recipient.email, subject, html);
  await logEmail(alert.recipient.id, alert.recipient.email, subject, ok ? 'sent' : 'failed');
}

export async function sendSecurityAlertEmail(email: string, ip?: string): Promise<void> {
  if (!isEmailConfigured()) return;
  const subject = 'Security Alert: Multiple failed login attempts';
  const html = `<h2>Security Alert</h2><p>We detected multiple failed login attempts on your account from IP: ${escapeHtml(ip ?? 'unknown')}.</p><p>If this wasn't you, please change your password immediately or contact your administrator.</p><p>If this was you, no action is needed.</p>`;
  const ok = await sendEmail(email, subject, html);
  await logEmail(null, email, subject, ok ? 'sent' : 'failed');
}
