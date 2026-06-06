export type ExecutiveMissingMetric = {
  metric: string;
  reason: string;
};

export type ExecutiveSummaryPayload = {
  usersTotal: number | null;
  activeSubscribers: number | null;
  revenueThisMonth: number | null;
  activeSubscriptionValue: number | null;
  cardRevenueThisMonth: number | null;
  mobileMoneyRevenueThisMonth: number | null;
  movieCount: number | null;
  seriesCount: number | null;
  requestCount: number | null;
  pendingRequests: number | null;
  failedRequestJobs: number | null;
  activeVideoJobs: number | null;
  failedVideoJobs: number | null;
  mobileMoneyCurrency: 'UGX';
  cardCurrency: 'ZAR';
  activeSubscriptionValueCurrency: 'UGX';
  topOperationalWarnings: string[];
  missingMetrics: ExecutiveMissingMetric[];
  timestamp: string;
};
