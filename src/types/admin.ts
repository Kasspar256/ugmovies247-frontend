import type { Movie } from '@/types/movie';
import type { PaymentAttemptDocument, SubscriptionSnapshot } from '@/types/subscriptions';

export type AdminCategoryType = 'home_row' | 'genre' | 'custom';

export type AdminCategory = {
  id: string;
  name: string;
  slug: string;
  description: string;
  type: AdminCategoryType;
  createdAt: string;
  updatedAt: string;
  isSystem: boolean;
};

export type AdminRequestStatus = 'new' | 'reviewing' | 'planned' | 'uploaded' | 'closed';

export type AdminRequest = {
  id: string;
  title: string;
  preferredVj: string;
  notes: string;
  status: AdminRequestStatus;
  requesterId: string;
  requesterName: string;
  requesterEmail: string;
  adminNotes: string;
  createdAt: string;
  updatedAt: string;
};

export type AdminUserSummary = {
  id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  joinDate: string;
  lastLoginAt: string;
  isActive: boolean;
  avatarUrl: string;
  subscription: SubscriptionSnapshot;
};

export type AdminRevenuePlanSummary = {
  planType: string;
  planName: string;
  activeCount: number;
  totalAmount: number;
};

export type AdminRevenueSummary = {
  monthLabel: string;
  monthRevenue: number;
  activeSubscriberCount: number;
  activeSubscriptionRevenue: number;
  activePlanBreakdown: AdminRevenuePlanSummary[];
  recentPayments: Array<
    Pick<
      PaymentAttemptDocument,
      | 'id'
      | 'userId'
      | 'planType'
      | 'planName'
      | 'amount'
      | 'currency'
      | 'status'
      | 'paymentProvider'
      | 'paymentMethodProvider'
      | 'phoneNumber'
      | 'providerStatus'
      | 'providerMessage'
      | 'createdAt'
      | 'updatedAt'
    >
  >;
};

export type AdminLibraryAssignment = {
  type: 'movie' | 'movie_part' | 'episode';
  movieId: string;
  movieTitle: string;
  seasonNumber?: number;
  episodeNumber?: number;
  partId?: string;
  partLabel?: string;
};

export type AdminLibraryAsset = {
  id: string;
  label: string;
  fileName: string;
  url: string;
  contentType: string;
  sourceType: 'upload' | 'remote_link' | 'direct_upload';
  fileSizeBytes: number;
  createdAt: string;
  updatedAt: string;
  isManaged: boolean;
  canDelete: boolean;
  assignments: AdminLibraryAssignment[];
};

export type AdminControlCenterPayload = {
  movies: Movie[];
  categories: AdminCategory[];
  users: AdminUserSummary[];
  requests: AdminRequest[];
  libraryAssets: AdminLibraryAsset[];
  revenue: AdminRevenueSummary;
};
