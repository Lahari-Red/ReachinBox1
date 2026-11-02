import { Client } from '@elastic/elasticsearch';
import { config } from '../config';
import { createLogger } from '../lib/logger';
import { EmailRow } from '../types';

const log = createLogger('search');

export const es = new Client({ node: config.elasticUrl, maxRetries: 1, requestTimeout: 5000 });
const index = config.elasticIndex;
let available = false;
let lastAttempt = 0;

/** If ES was down at boot, try again (at most every 30s) instead of staying disabled forever. */
async function ready(): Promise<boolean> {
  if (!available && Date.now() - lastAttempt > 30_000) await ensureIndex();
  return available;
}

export interface EmailDoc {
  id: string;
  user_id: number;
  campaign_id: number;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  scheduled_at: string;
  sent_at: string | null;
  sender_email?: string;
}

export const toDoc = (e: EmailRow, senderEmail?: string): EmailDoc => ({
  id: e.id,
  user_id: e.user_id,
  campaign_id: e.campaign_id,
  recipient: e.recipient,
  subject: e.subject,
  body: e.body,
  status: e.status,
  scheduled_at: new Date(e.scheduled_at).toISOString(),
  sent_at: e.sent_at ? new Date(e.sent_at).toISOString() : null,
  sender_email: senderEmail,
});

export async function ensureIndex(): Promise<void> {
  lastAttempt = Date.now();
  try {
    const exists = await es.indices.exists({ index });
    if (!exists) {
      await es.indices.create({
        index,
        mappings: {
          properties: {
            id: { type: 'keyword' },
            user_id: { type: 'integer' },
            campaign_id: { type: 'integer' },
            recipient: { type: 'text', fields: { keyword: { type: 'keyword' } } },
            subject: { type: 'text' },
            body: { type: 'text' },
            status: { type: 'keyword' },
            sender_email: { type: 'keyword' },
            scheduled_at: { type: 'date' },
            sent_at: { type: 'date' },
          },
        },
      });
      log.info(`created index "${index}"`);
    }
    available = true;
  } catch (err) {
    // Another process created the index between our exists() and create() — that's fine.
    if (/resource_already_exists/.test(String((err as Error).message))) {
      available = true;
      return;
    }
    available = false;
    log.warn('Elasticsearch unavailable — search disabled, scheduling unaffected', err);
  }
}

/**
 * Indexing is best-effort: Postgres is the source of truth, ES is a read model.
 * A failed index call never fails a schedule request or a send.
 */
export async function indexEmails(docs: EmailDoc[]): Promise<void> {
  if (docs.length === 0 || !(await ready())) return;
  try {
    const operations = docs.flatMap((d) => [{ index: { _index: index, _id: d.id } }, d]);
    const res = await es.bulk({ operations, refresh: false });
    if (res.errors) log.warn('some documents failed to index');
  } catch (err) {
    log.warn('bulk index failed', err);
  }
}

export async function updateEmailDoc(id: string, patch: Partial<EmailDoc>): Promise<void> {
  if (!(await ready())) return;
  try {
    await es.update({ index, id, doc: patch, doc_as_upsert: false, retry_on_conflict: 3 });
  } catch (err) {
    log.warn(`update doc ${id} failed`, err);
  }
}

export async function searchEmails(userId: number, q: string, status?: string, size = 50) {
  if (!(await ready())) throw new Error('Search is unavailable (Elasticsearch not reachable)');
  const filter: object[] = [{ term: { user_id: userId } }];
  if (status) filter.push({ terms: { status: status.split(',') } });
  const res = await es.search<EmailDoc>({
    index,
    size,
    query: {
      bool: {
        filter,
        must: q
          ? [{ multi_match: { query: q, fields: ['recipient^3', 'subject^2', 'body'], fuzziness: 'AUTO' } }]
          : [{ match_all: {} }],
      },
    },
    sort: q ? undefined : [{ scheduled_at: 'desc' }],
  });
  return res.hits.hits.map((h) => h._source!).filter(Boolean);
}
