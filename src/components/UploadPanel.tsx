import { useCallback, useState, useRef } from 'react';
import { useData } from '../context/DataContext';

export default function UploadPanel() {
  const { uploadCSV, isLoading, rawShipments, fileName, clearData } = useData();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.endsWith('.csv')) {
        alert('Please upload a .csv file');
        return;
      }
      await uploadCSV(file);
    },
    [uploadCSV]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  if (rawShipments.length > 0) {
    return (
      <div
        className="rounded-xl p-4 mb-4 flex items-center justify-between"
        style={{ background: '#fff', border: '1px solid #e5e7eb' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(68,114,232,0.1)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4472E8" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <div>
            <div className="font-bold text-sm" style={{ color: '#252F3E' }}>
              {fileName}
            </div>
            <div className="text-xs text-gray-500">
              {rawShipments.length.toLocaleString()} shipments loaded
            </div>
          </div>
          <div
            className="px-2 py-0.5 rounded-full text-xs font-bold"
            style={{ background: 'rgba(34,197,94,0.15)', color: '#16a34a' }}
          >
            Active
          </div>
        </div>
        <button
          onClick={() => {
            clearData();
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
          className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all hover:opacity-80"
          style={{ background: '#F5F5F0', color: '#6b7280', border: '1px solid #e5e7eb' }}
        >
          Upload New Report
        </button>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className="rounded-xl p-10 text-center cursor-pointer transition-all"
        style={{
          background: isDragging ? 'rgba(68,114,232,0.08)' : '#fff',
          border: `2px dashed ${isDragging ? '#4472E8' : '#d1d5db'}`,
        }}
      >
        {isLoading ? (
          <div className="flex flex-col items-center gap-3">
            <svg className="animate-spin h-10 w-10" style={{ color: '#4472E8' }} fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-gray-500 font-semibold">Parsing CSV...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mb-2"
              style={{ background: isDragging ? 'rgba(68,114,232,0.15)' : '#F5F5F0' }}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={isDragging ? '#4472E8' : '#9ca3af'} strokeWidth="1.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <div>
              <p className="font-bold text-base" style={{ color: '#252F3E' }}>
                Drop your ShipHero CSV here
              </p>
              <p className="text-sm text-gray-500 mt-1">
                or <span style={{ color: '#4472E8' }} className="font-semibold">browse to upload</span>
              </p>
            </div>
            <p className="text-xs text-gray-400">Accepts .csv files from ShipHero exports</p>
          </div>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        onChange={handleInputChange}
        className="hidden"
      />
    </div>
  );
}
