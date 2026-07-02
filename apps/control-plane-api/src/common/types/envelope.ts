export interface DataEnvelope<TData> {
  data: TData;
}

export interface Pagination {
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ListEnvelope<TData> {
  data: TData[];
  pagination: Pagination;
}
