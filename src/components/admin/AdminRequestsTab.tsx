import { Check, Search } from 'lucide-react';
import type { AdminRequest, AdminRequestStatus } from '@/types/admin';
import { Card, SelectInput, TextArea, TextInput } from '@/components/admin/controlCenterFields';
import { REQUEST_STATUS_OPTIONS, formatDate } from '@/components/admin/controlCenterUtils';

export function AdminRequestsTab({
  requests,
  search,
  onSearchChange,
  requestEdits,
  onChangeRequestEdit,
  onSaveRequest,
  actionBusy,
}: {
  requests: AdminRequest[];
  search: string;
  onSearchChange: (value: string) => void;
  requestEdits: Record<string, { status: AdminRequestStatus; adminNotes: string }>;
  onChangeRequestEdit: (
    requestId: string,
    nextEdit: { status: AdminRequestStatus; adminNotes: string }
  ) => void;
  onSaveRequest: (requestId: string) => void;
  actionBusy: boolean;
}) {
  return (
    <Card
      title="Requests Queue"
      description="Keep user requests moving from new to reviewing to planned to uploaded to closed."
    >
      <div className="mb-4 relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
        <TextInput
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search requests..."
          className="pl-10"
        />
      </div>
      <div className="space-y-4">
        {requests.map((request) => {
          const requestEdit = requestEdits[request.id] || {
            status: request.status,
            adminNotes: request.adminNotes || '',
          };

          return (
            <div
              key={request.id}
              className="rounded-2xl border border-white/10 bg-black/20 p-4"
            >
              <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
                <div>
                  <div className="text-sm font-bold text-white">{request.title}</div>
                  <div className="mt-2 text-xs leading-6 text-white/55">
                    {request.notes || 'No requester note.'}
                  </div>
                  <div className="mt-2 text-xs text-white/45">
                    {request.requesterEmail || request.requesterName || 'Anonymous'} |{' '}
                    {formatDate(request.createdAt)}
                  </div>
                </div>
                <div className="space-y-4">
                  <SelectInput
                    value={requestEdit.status}
                    onChange={(event) =>
                      onChangeRequestEdit(request.id, {
                        ...requestEdit,
                        status: event.target.value as AdminRequestStatus,
                      })
                    }
                  >
                    {REQUEST_STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </SelectInput>
                  <TextArea
                    rows={4}
                    value={requestEdit.adminNotes}
                    onChange={(event) =>
                      onChangeRequestEdit(request.id, {
                        ...requestEdit,
                        adminNotes: event.target.value,
                      })
                    }
                    placeholder="Admin note..."
                  />
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => onSaveRequest(request.id)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#D90429] px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
                  >
                    <Check size={14} />
                    Save Request
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
