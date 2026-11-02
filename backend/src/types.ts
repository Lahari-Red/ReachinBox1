export type EmailStatus = 'scheduled' | 'rate_limited' | 'sending' | 'sent' | 'failed';

export const PENDING_STATUSES: EmailStatus[] = ['scheduled', 'rate_limited', 'sending'];
export const DONE_STATUSES: EmailStatus[] = ['sent', 'failed'];

export interface User {
  id: number;
  google_id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
}

export interface Sender {
  id: number;
  email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
}

export interface EmailRow {
  id: string;
  campaign_id: number;
  user_id: number;
  sender_id: number;
  seq: number;
  recipient: string;
  subject: string;
  body: string;
  scheduled_at: Date;
  status: EmailStatus;
  attempts: number;
  sent_at: Date | null;
  message_id: string | null;
  preview_url: string | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

/** An email joined with what the worker needs to send it. */
export interface EmailForSend extends EmailRow {
  hourly_limit: number;
  sender_email: string;
}

export interface EmailJobData {
  emailId: string;
}
