import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

export default function RouteLoadingIndicator() {
  const { pathname } = useLocation();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => setLoading(false), 800);
    return () => clearTimeout(t);
  }, [pathname]);

  if (!loading) return null;

  return (
    <div className="fixed inset-0 z-[10000] pointer-events-none">
      {/* Lightning bolt - full screen width */}
      <svg
        viewBox="0 0 200 100"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full animate-bolt-sweep"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="route-bolt" x1="100" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#fef08a" />
            <stop offset="30%" stopColor="#facc15" />
            <stop offset="100%" stopColor="#a78bfa" />
          </linearGradient>
          <filter id="route-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path
          d="M105 0 L90 15 L110 18 L80 35 L115 38 L65 60 L108 63 L30 100 L130 58 L92 55 L125 36 L88 33 L110 16 L88 13 L105 0 Z"
          fill="url(#route-bolt)"
          filter="url(#route-glow)"
        />
      </svg>
    </div>
  );
}
