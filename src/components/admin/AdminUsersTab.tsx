import { Search } from 'lucide-react';
import type { AdminUserSummary } from '@/types/admin';
import { Card, TextInput } from '@/components/admin/controlCenterFields';
import { formatDate } from '@/components/admin/controlCenterUtils';

export function AdminUsersTab({
  users,
  search,
  onSearchChange,
}: {
  users: AdminUserSummary[];
  search: string;
  onSearchChange: (value: string) => void;
}) {
  return (
    <Card
      title="Users Management"
      description="Search users, inspect subscription status, and see who is active right now."
    >
      <div className="mb-4 relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
        <TextInput
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search users..."
          className="pl-10"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-[0.2em] text-white/45">
            <tr>
              <th className="px-3 py-3">User</th>
              <th className="px-3 py-3">Role</th>
              <th className="px-3 py-3">Subscription</th>
              <th className="px-3 py-3">Plan</th>
              <th className="px-3 py-3">Join Date</th>
              <th className="px-3 py-3">Last Login</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-t border-white/10">
                <td className="px-3 py-4">
                  <div className="font-semibold text-white">{user.name}</div>
                  <div className="mt-1 text-xs text-white/50">{user.email}</div>
                </td>
                <td className="px-3 py-4 text-white/75">{user.role}</td>
                <td className="px-3 py-4 text-white/75">{user.subscription.status}</td>
                <td className="px-3 py-4 text-white/75">{user.subscription.planName || '-'}</td>
                <td className="px-3 py-4 text-white/75">{formatDate(user.joinDate)}</td>
                <td className="px-3 py-4 text-white/75">{formatDate(user.lastLoginAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
