import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { hybridRatio } from '../pipeline';
import type { HybridCounts } from '../types';

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function HybridMeter({ counts }: { counts: HybridCounts }) {
  return (
    <p className="meter" aria-live="polite" title="Where the AI ran in this session">
      <span>
        on-device reads: <strong>{counts.deviceReads}</strong>
      </span>
      <span aria-hidden="true">·</span>
      <span>
        cloud calls: <strong>{counts.cloudCalls}</strong>
      </span>
      <span aria-hidden="true">·</span>
      <span>
        ratio <strong>{hybridRatio(counts)}</strong>
      </span>
    </p>
  );
}

interface TopBarProps {
  counts: HybridCounts;
  cloudMode: boolean;
}

export function TopBar({ counts, cloudMode }: TopBarProps) {
  const online = useOnline();
  return (
    <header className="topbar">
      <Link to="/" className="brand">
        Rough Work
      </Link>
      <HybridMeter counts={counts} />
      <div className="topbar-badges">
        {cloudMode && (
          <span className="badge badge-cloud" title="Gemini Nano is not available here. Lines are read in the cloud, more slowly.">
            cloud mode
          </span>
        )}
        <span className={`badge ${online ? 'badge-online' : 'badge-offline'}`}>
          <span className="dot" aria-hidden="true" />
          {online ? 'online' : 'offline'}
        </span>
      </div>
    </header>
  );
}
