// Lifetime free-trial credit allowance per user for Ayo AI.
// Shared between trial enforcement (ask flow) and admin usage reporting.
export const AYO_CREDIT_LIMIT_PER_USER = 200_000;
export const TOKEN_LIMIT_PER_USER = AYO_CREDIT_LIMIT_PER_USER;
export const AYO_CREDITS_PER_USD = 1_000_000;

export function calculateAyoCredits(params: {
  inputTokens?: number | null;
  outputTokens?: number | null;
  costPer1MInputTokensUSD: number;
  costPer1MOutputTokensUSD: number;
}): number {
  const inputTokens = Math.max(0, params.inputTokens ?? 0);
  const outputTokens = Math.max(0, params.outputTokens ?? 0);

  if (inputTokens === 0 && outputTokens === 0) return 0;

  const estimatedCostUSD =
    (inputTokens / 1_000_000) * params.costPer1MInputTokensUSD +
    (outputTokens / 1_000_000) * params.costPer1MOutputTokensUSD;

  return Math.max(
    1,
    Math.ceil(estimatedCostUSD * AYO_CREDITS_PER_USD - 1e-9),
  );
}
