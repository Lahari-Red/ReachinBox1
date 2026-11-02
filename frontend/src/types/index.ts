export interface User {
  id: number;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export type EmailStatus = 'scheduled' | 'rate_limited' | 'sending' | 'sent' | 'failed';

export interface EmailItem {
  id: string;
  recipient: string;
  subject: string;
  status: EmailStatus;
  scheduled_at: string;
  sent_at: string | null;
  error: string | null;
  preview_url: string | null;
  attempts: number;
  campaign_id: number;
  sender_email: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type EmailStats = Record<EmailStatus, number>;

export interface SchedulePayload {
  subject: string;
  body: string;
  recipients: string[];
  startTime: string;
  delayBetweenMs: number;
  hourlyLimit: number;
}

export interface ScheduleResult {
  campaignId: number;
  count: number;
  firstSendAt: string;
  lastSendAt: string;
}

export interface SearchHit {
  id: string;
  recipient: string;
  subject: string;
  status: EmailStatus;
  scheduled_at: string;
  sent_at: string | null;
  sender_email?: string;
}

export interface SlackStatus {
  configured: boolean;
  connected: boolean;
  teamName: string | null;
  channel: string | null;
}

export interface SendersInfo {
  items: { id: number; email: string }[];
  limits: { maxPerHourPerSender: number; minDelayBetweenEmailsMs: number; concurrency: number };
}

export type TabKey = 'scheduled' | 'sent';
