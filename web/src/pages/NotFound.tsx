import { Link } from 'react-router-dom';
import { ArrowLeft, Home } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-8">
      <div className="text-center max-w-lg">
        <div className="mb-6">
          <span className="text-8xl font-black text-violet-600/20">404</span>
        </div>
        <h1 className="text-3xl font-bold text-white mb-3">Page Not Found</h1>
        <p className="text-slate-400 mb-8 text-lg">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="flex items-center justify-center gap-4">
          <button onClick={() => window.history.back()}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-xl transition">
            <ArrowLeft className="h-4 w-4" />Go Back
          </button>
          <Link to="/dashboard"
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-violet-600 hover:bg-violet-500 rounded-xl transition">
            <Home className="h-4 w-4" />Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
