import { Check, MessageSquareText, Search, UploadCloud, XCircle } from 'lucide-react';
import type { AdminRequest, AdminRequestStatus } from '@/types/admin';
import { Card, SelectInput, TextArea, TextInput } from '@/components/admin/controlCenterFields';
import { REQUEST_STATUS_OPTIONS, formatDate } from '@/components/admin/controlCenterUtils';

type RequestEdit = {
  status: AdminRequestStatus;
  adminNotes: string;
  sourceUrl: string;
  customReply: string;
  rejectionMessage: string;
  movieId: string;
};

export function AdminRequestsTab({
  requests,
  search,
  onSearchChange,
  requestEdits,
  onChangeRequestEdit,
  onSaveRequest,
  onRequestAction,
  actionBusy,
}: {
  requests: AdminRequest[];
  search: string;
  onSearchChange: (value: string) => void;
  requestEdits: Record<string, RequestEdit>;
  onChangeRequestEdit: (requestId: string, nextEdit: RequestEdit) => void;
  onSaveRequest: (requestId: string) => void;
  onRequestAction: (requestId: string, action: 'fulfill' | 'reply' | 'reject') => void;
  actionBusy: boolean;
}) {
  return (
    <Card
      title="Movie Request Command Center"
      description="Request records stay in the isolated movie_requests pipeline. Fulfill queues work for the secondary VPS; replies and rejections notify the user instantly."
    >
      <div className="relative mb-4">
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
            sourceUrl: request.sourceUrl || '',
            customReply: request.customReply || '',
            rejectionMessage: request.rejectionMessage || '',
            movieId: request.movieId || '',
          };
          const requester = request.userEmail || request.requesterEmail || request.requesterName || 'Unknown user';

          return (
            <div
              key={request.id}
              className="rounded-2xl border border-white/10 bg-black/20 p-4"
            >
              <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="text-base font-black text-white">{request.title}</div>
                    <span className="rounded-full border border-[#D90429]/25 bg-[#D90429]/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-red-100">
                      {request.status}
                    </span>
                    {request.fcmToken && (
                      <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-100">
                        Push Ready
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-xs leading-6 text-white/55">
                    {request.notes || 'No requester note.'}
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-white/45 sm:grid-cols-2">
                    <div>User: {requester}</div>
                    <div>Requested: {formatDate(request.createdAt || request.timestamp)}</div>
                    {request.preferredVj && <div>Preferred VJ: {request.preferredVj}</div>}
                    {request.movieId && <div>Movie ID: {request.movieId}</div>}
                    {request.queuedAt && <div>Queued: {formatDate(request.queuedAt)}</div>}
                    {request.uploadedAt && <div>Uploaded: {formatDate(request.uploadedAt)}</div>}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
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
                    <TextInput
                      value={requestEdit.movieId}
                      onChange={(event) =>
                        onChangeRequestEdit(request.id, {
                          ...requestEdit,
                          movieId: event.target.value,
                        })
                      }
                      placeholder="Movie ID if already uploaded..."
                    />
                  </div>
                  <TextArea
                    rows={3}
                    value={requestEdit.adminNotes}
                    onChange={(event) =>
                      onChangeRequestEdit(request.id, {
                        ...requestEdit,
                        adminNotes: event.target.value,
                      })
                    }
                    placeholder="Private admin note..."
                  />
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => onSaveRequest(request.id)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-white/10 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
                  >
                    <Check size={14} />
                    Save Status
                  </button>

                  <div className="rounded-2xl border border-sky-300/15 bg-sky-400/[0.05] p-3">
                    <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.2em] text-sky-100/70">
                      Fulfill via Request VPS
                    </label>
                    <TextInput
                      value={requestEdit.sourceUrl}
                      onChange={(event) =>
                        onChangeRequestEdit(request.id, {
                          ...requestEdit,
                          sourceUrl: event.target.value,
                        })
                      }
                      placeholder="Paste raw MP4/MKV/WebM link for the secondary VPS..."
                    />
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => onRequestAction(request.id, 'fulfill')}
                      className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-sky-500 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
                    >
                      <UploadCloud size={14} />
                      Queue Fulfill
                    </button>
                  </div>

                  <div className="rounded-2xl border border-amber-300/15 bg-amber-400/[0.05] p-3">
                    <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.2em] text-amber-100/70">
                      Custom Reply
                    </label>
                    <TextArea
                      rows={3}
                      value={requestEdit.customReply}
                      onChange={(event) =>
                        onChangeRequestEdit(request.id, {
                          ...requestEdit,
                          customReply: event.target.value,
                        })
                      }
                      placeholder="Example: We only have the VJ Junior version. It is uploading now..."
                    />
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => onRequestAction(request.id, 'reply')}
                      className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-amber-500 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-black disabled:opacity-60"
                    >
                      <MessageSquareText size={14} />
                      Send Reply
                    </button>
                  </div>

                  <div className="rounded-2xl border border-red-300/15 bg-red-500/[0.05] p-3">
                    <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.2em] text-red-100/70">
                      Reject Request
                    </label>
                    <TextArea
                      rows={2}
                      value={requestEdit.rejectionMessage}
                      onChange={(event) =>
                        onChangeRequestEdit(request.id, {
                          ...requestEdit,
                          rejectionMessage: event.target.value,
                        })
                      }
                      placeholder="Optional polite rejection message..."
                    />
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => onRequestAction(request.id, 'reject')}
                      className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#D90429] px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
                    >
                      <XCircle size={14} />
                      Reject & Notify
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {!requests.length && (
          <div className="rounded-2xl border border-white/10 bg-black/20 p-6 text-center text-sm text-white/55">
            No movie requests found.
          </div>
        )}
      </div>
    </Card>
  );
}
