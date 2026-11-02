const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export interface ParsedLeads {
  emails: string[];
  duplicates: number;
}

/**
 * Extracts addresses from CSV or plain-text lead files. Works regardless of
 * column order, header row, or delimiter — it simply pulls every email-looking
 * token and de-duplicates case-insensitively, preserving first-seen order.
 */
export function parseLeads(text: string): ParsedLeads {
  const found = text.match(EMAIL_RE) ?? [];
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const raw of found) {
    const e = raw.toLowerCase();
    if (!seen.has(e)) {
      seen.add(e);
      emails.push(e);
    }
  }
  return { emails, duplicates: found.length - emails.length };
}

export const readFileText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsText(file);
  });
