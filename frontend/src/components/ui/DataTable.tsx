import { ReactNode } from 'react';
import { Spinner } from './Spinner';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  empty: ReactNode;
}

/** Generic table used by both Scheduled and Sent tabs (and search results). */
export function DataTable<T>({ columns, rows, rowKey, loading, empty }: DataTableProps<T>) {
  if (loading && rows.length === 0) {
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-sm text-ink-500">
        <Spinner /> Loading emails…
      </div>
    );
  }
  if (rows.length === 0) return <>{empty}</>;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-500">
            {columns.map((c) => (
              <th key={c.key} className={`whitespace-nowrap px-5 py-3 font-medium ${c.className ?? ''}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="hover:bg-ink-50">
              {columns.map((c) => (
                <td key={c.key} className={`px-5 py-3 align-middle ${c.className ?? ''}`}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
