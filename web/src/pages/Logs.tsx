import DashboardLayout from '@/components/DashboardLayout';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDateTime, statusColor } from '@/lib/utils';
import { History, Filter } from 'lucide-react';
import { useState, useMemo } from 'react';
import ResponsiveTable, { type Column } from '@/components/ResponsiveTable';

export default function LogsPage() {
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const { data } = useQuery({ 
    queryKey: ['logs', actionFilter, entityFilter], 
    queryFn: async () => (await api.get('/activity-logs', { params: { action: actionFilter || undefined, entityType: entityFilter || undefined, limit: 50 } })).data 
  });

  const filteredLogs = data?.logs?.filter((l: any) => {
    if (actionFilter && l.action !== actionFilter) return false;
    if (entityFilter && l.entityType !== entityFilter) return false;
    return true;
  }) || data?.logs || [];

  const uniqueActions = (data?.logs?.map((l: any) => l.action as string) || []).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);
  const uniqueEntities = (data?.logs?.map((l: any) => l.entityType as string) || []).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);

  const logColumns = useMemo<Column<any>[]>(() => [
    { header: 'Action', key: 'action', render: (l: any) => <span className={`inline-flex px-2 py-0.5 rounded-lg text-xs font-medium border ${statusColor(l.action)}`}>{l.action}</span> },
    { header: 'Entity', key: 'entity', render: (l: any) => <span className="text-slate-300">{l.entityType}{l.entityId ? ` (${l.entityId.slice(0, 8)}...)` : ''}</span> },
    { header: 'Time', key: 'time', render: (l: any) => <span className="text-slate-400 text-xs">{formatDateTime(l.createdAt)}</span> },
    { header: 'IP', key: 'ip', render: (l: any) => <span className="text-slate-500 text-xs">{l.ipAddress || '-'}</span> },
  ], []);

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Activity Logs</h1>
        </div>

        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[150px] max-w-xs">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-800 pl-10 pr-4 py-2.5 text-sm text-white">
              <option value="">All Actions</option>
              {uniqueActions.map((a: string) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="relative flex-1 min-w-[150px] max-w-xs">
            <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white">
              <option value="">All Entities</option>
              {uniqueEntities.map((e: string) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
        </div>

        <ResponsiveTable
          columns={logColumns}
          data={filteredLogs}
          rowKey={(l: any) => l.id}
          empty={<> <History className="h-8 w-8 mx-auto mb-2 opacity-30" />No logs </>}
        />
      </div>
    </DashboardLayout>
  );
}
