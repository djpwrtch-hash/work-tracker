export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] p-6">
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-48 bg-slate-800 rounded-lg" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-24 bg-slate-900 border border-slate-800 rounded-2xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-64 bg-slate-900 border border-slate-800 rounded-2xl" />
          <div className="h-64 bg-slate-900 border border-slate-800 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
