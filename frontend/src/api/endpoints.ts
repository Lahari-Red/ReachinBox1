import { api } from './client';
import type {
  EmailItem,
  EmailStats,
  Paginated,
  SchedulePayload,
  ScheduleResult,
  SearchHit,
  SendersInfo,
  SlackStatus,
  TabKey,
  User,
} from '../types';

export const authApi = {
  loginWithGoogle: (credential: string) =>
    api<{ token: string; user: User }>('/api/auth/google', { method: 'POST', json: { credential } }),
  me: () => api<{ user: User }>('/api/auth/me'),
  logout: () => api<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
};

export const emailApi = {
  list: (tab: TabKey, page = 1, pageSize = 25) =>
    api<Paginated<EmailItem>>(`/api/emails/${tab}?page=${page}&pageSize=${pageSize}`),
  stats: () => api<EmailStats>('/api/emails/stats'),
  schedule: (payload: SchedulePayload) =>
    api<ScheduleResult>('/api/emails/schedule', { method: 'POST', json: payload }),
  search: (q: string, status?: string) =>
    api<{ items: SearchHit[] }>(
      `/api/emails/search?q=${encodeURIComponent(q)}${status ? `&status=${status}` : ''}`,
    ),
  senders: () => api<SendersInfo>('/api/emails/senders'),
};

export const slackApi = {
  status: () => api<SlackStatus>('/api/slack/status'),
  installUrl: () => api<{ url: string }>('/api/slack/install-url'),
  test: () => api<{ ok: boolean }>('/api/slack/test', { method: 'POST' }),
  disconnect: () => api<{ ok: boolean }>('/api/slack', { method: 'DELETE' }),
};
