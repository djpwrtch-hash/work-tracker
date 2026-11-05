'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export default function TwoFactorQR({ uri, size = 200 }: { uri: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(uri, { width: size, margin: 1 })
      .then((dataUrl) => { if (!cancelled) setSrc(dataUrl); })
      .catch(() => { if (!cancelled) setSrc(null); });
    return () => { cancelled = true; };
  }, [uri, size]);

  if (!src) {
    return <div style={{ width: size, height: size }} className="rounded-xl bg-slate-700/40 animate-pulse flex items-center justify-center text-xs text-slate-400">Loading…</div>;
  }

  return <img src={src} width={size} height={size} alt="QR code for two-factor authentication" className="rounded-xl" />;
}
