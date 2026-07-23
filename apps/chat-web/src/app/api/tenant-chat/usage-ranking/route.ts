import {
  UsageRankingContractError,
  usageRankingQuery,
} from '@/lib/usage-ranking-contract.mjs';
import {
  usageRankingError,
  usageRankingFromApi,
} from '@/lib/usage-ranking-server';

export async function GET(request: Request) {
  try {
    const query = usageRankingQuery(request.url);
    return usageRankingFromApi({ ...query, request });
  } catch (error) {
    return usageRankingError(
      error instanceof UsageRankingContractError ? error : new UsageRankingContractError(),
    );
  }
}
