'use client';

import { useState } from 'react';
import { FileDown, Printer } from 'lucide-react';

interface Props {
  sessionId: string;
  sessionCode: string;
}

export function ExportButtons({ sessionId, sessionCode }: Props) {
  const [downloading, setDownloading] = useState(false);

  const handleVabiExport = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/export/vabi/${sessionId}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Export failed' }));
        alert(err.error ?? 'Export failed');
        return;
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${sessionCode}_VABI.xml`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  const handlePdfPrint = () => {
    window.open(`/sessions/${sessionId}/print`, '_blank');
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleVabiExport}
        disabled={downloading}
        className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        title="Export VABI XML (NTA 8800)"
      >
        <FileDown className="w-4 h-4" />
        {downloading ? 'Exporting…' : 'VABI XML'}
      </button>

      <button
        onClick={handlePdfPrint}
        className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors"
        title="Open printable PDF report"
      >
        <Printer className="w-4 h-4" />
        PDF Report
      </button>
    </div>
  );
}
