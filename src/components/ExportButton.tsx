import { useState } from 'react';
import { downloadCSV, fileDate } from '../utils/exportCsv';

interface Props {
  /** Data rows to export */
  data: Record<string, string | number | null | undefined>[];
  /** Base filename (no extension needed) */
  filename: string;
}

export default function ExportButton({ data, filename }: Props) {
  const [copied, setCopied] = useState(false);

  const handleExport = () => {
    if (data.length === 0) return;
    downloadCSV(data, `${filename}_${fileDate()}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <button
      onClick={handleExport}
      disabled={data.length === 0}
      title="Export as CSV — open in Google Sheets, then copy into Slides"
      className="flex items-center justify-center rounded-lg transition-all"
      style={{
        width: 28, height: 28,
        background: copied ? 'rgba(34,197,94,0.12)' : 'rgba(68,114,232,0.08)',
        color: copied ? '#15803D' : '#4472E8',
        border: copied ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(68,114,232,0.2)',
        opacity: data.length === 0 ? 0.4 : 1,
        cursor: data.length === 0 ? 'not-allowed' : 'pointer',
      }}
    >
      {copied ? (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <polyline points="2 6 5 9 10 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path d="M6 1v7M3 5l3 3 3-3M1 10h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
