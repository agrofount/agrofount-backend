import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ChartGranularity } from './dto/ai-analytics-query.dto';
import { AiSettingsService } from './ai-settings.service';
import { AiUserQuotaEntity } from './entities/ai-user-quota.entity';
import { TOKEN_LIMIT_PER_USER } from './ai-farm-assistant.constants';

const DISEASE_KEYWORDS: { label: string; keywords: string[] }[] = [
  {
    label: 'Newcastle Disease Reports',
    keywords: ['newcastle', 'newcastle disease', 'nd virus', 'lasota'],
  },
  {
    label: 'Coccidiosis Reports',
    keywords: ['coccidiosis', 'cocci', 'bloody dropping', 'coccivet'],
  },
  {
    label: 'High Mortality Reports',
    keywords: [
      'high mortality',
      'many died',
      'many are dying',
      'sudden death',
      'unusual death',
    ],
  },
  {
    label: 'Gumboro Reports',
    keywords: ['gumboro', 'ibd', 'infectious bursal'],
  },
  {
    label: 'Fowl Pox Reports',
    keywords: ['fowl pox', 'fowlpox', 'pox lesion'],
  },
];

@Injectable()
export class AiAnalyticsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly aiSettingsService: AiSettingsService,
    @InjectRepository(AiUserQuotaEntity)
    private readonly quotaRepository: Repository<AiUserQuotaEntity>,
  ) {}

  // ── date helpers ──────────────────────────────────────────────────────────

  private parseDateRange(from?: string, to?: string): { from: Date; to: Date } {
    const toDate = to ? new Date(to) : new Date();
    toDate.setHours(23, 59, 59, 999);
    const fromDate = from
      ? new Date(from)
      : new Date(toDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    fromDate.setHours(0, 0, 0, 0);
    return { from: fromDate, to: toDate };
  }

  private previousPeriod(from: Date, to: Date): { from: Date; to: Date } {
    const duration = to.getTime() - from.getTime();
    return {
      from: new Date(from.getTime() - duration - 1),
      to: new Date(from.getTime() - 1),
    };
  }

  private pct(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return parseFloat((((current - previous) / previous) * 100).toFixed(1));
  }

  // ── summary ───────────────────────────────────────────────────────────────

  async getSummary(from?: string, to?: string) {
    const period = this.parseDateRange(from, to);
    const prev = this.previousPeriod(period.from, period.to);

    const [current, previous] = await Promise.all([
      this.computeSummaryMetrics(period.from, period.to),
      this.computeSummaryMetrics(prev.from, prev.to),
    ]);

    return {
      totalChats: {
        value: current.totalChats,
        change: this.pct(current.totalChats, previous.totalChats),
      },
      activeFarmers: {
        value: current.activeFarmers,
        change: this.pct(current.activeFarmers, previous.activeFarmers),
      },
      vetEscalations: {
        value: current.vetEscalations,
        change: this.pct(current.vetEscalations, previous.vetEscalations),
      },
      revenueInfluenced: {
        value: current.revenueInfluenced,
        change: this.pct(current.revenueInfluenced, previous.revenueInfluenced),
      },
      ordersFromAyo: {
        value: current.ordersFromAyo,
        change: this.pct(current.ordersFromAyo, previous.ordersFromAyo),
      },
      satisfactionRate: {
        // requires explicit user feedback collection — not yet tracked
        value: null as number | null,
        change: null as number | null,
      },
    };
  }

  private async computeSummaryMetrics(from: Date, to: Date) {
    const [chats, farmers, vet, orders] = await Promise.all([
      this.dataSource.query<{ count: number }[]>(
        `SELECT COUNT(*)::int AS count
         FROM farm_assistant_conversation
         WHERE "createdAt" BETWEEN $1 AND $2`,
        [from, to],
      ),
      this.dataSource.query<{ count: number }[]>(
        `SELECT COUNT(DISTINCT "userId")::int AS count
         FROM farm_assistant_conversation
         WHERE "createdAt" BETWEEN $1 AND $2`,
        [from, to],
      ),
      this.dataSource.query<{ count: number }[]>(
        `SELECT COUNT(*)::int AS count
         FROM farm_assistant_message
         WHERE role = 'assistant'
           AND (metadata->>'requiresVetAttention')::boolean = true
           AND "createdAt" BETWEEN $1 AND $2`,
        [from, to],
      ),
      // Attribution: orders placed within 24 h of an AI conversation by the same user
      this.dataSource.query<{ orders: number; revenue: number }[]>(
        `SELECT COUNT(DISTINCT o.id)::int AS orders,
                COALESCE(SUM(o."totalPrice"), 0)::float AS revenue
         FROM orders o
         WHERE o."createdAt" BETWEEN $1 AND $2
           AND EXISTS (
             SELECT 1
             FROM farm_assistant_conversation c
             WHERE c."userId" = o."userId"::uuid
               AND c."updatedAt" >= o."createdAt" - INTERVAL '24 hours'
               AND c."updatedAt" <= o."createdAt"
           )`,
        [from, to],
      ),
    ]);

    return {
      totalChats: chats[0].count,
      activeFarmers: farmers[0].count,
      vetEscalations: vet[0].count,
      ordersFromAyo: orders[0].orders,
      revenueInfluenced: orders[0].revenue,
    };
  }

  // ── chats over time ───────────────────────────────────────────────────────

  async getChatsOverTime(
    from?: string,
    to?: string,
    granularity: ChartGranularity = ChartGranularity.Day,
  ) {
    const period = this.parseDateRange(from, to);
    const trunc = granularity === ChartGranularity.Week ? 'week' : 'day';

    const rows = await this.dataSource.query<{ date: string; count: number }[]>(
      `SELECT DATE_TRUNC($1, "createdAt") AS date, COUNT(*)::int AS count
       FROM farm_assistant_conversation
       WHERE "createdAt" BETWEEN $2 AND $3
       GROUP BY DATE_TRUNC($1, "createdAt")
       ORDER BY date ASC`,
      [trunc, period.from, period.to],
    );

    return rows.map((row) => ({ date: row.date, count: row.count }));
  }

  // ── conversation funnel ───────────────────────────────────────────────────

  async getFunnel(from?: string, to?: string) {
    const period = this.parseDateRange(from, to);

    const [chats, recommendations, orders] = await Promise.all([
      this.dataSource.query<{ count: number }[]>(
        `SELECT COUNT(*)::int AS count
         FROM farm_assistant_conversation
         WHERE "createdAt" BETWEEN $1 AND $2`,
        [period.from, period.to],
      ),
      this.dataSource.query<{ count: number }[]>(
        `SELECT COUNT(DISTINCT "conversationId")::int AS count
         FROM farm_assistant_message
         WHERE role = 'assistant'
           AND jsonb_array_length(COALESCE(metadata->'suggestedProducts', '[]'::jsonb)) > 0
           AND "createdAt" BETWEEN $1 AND $2`,
        [period.from, period.to],
      ),
      this.dataSource.query<{ count: number }[]>(
        `SELECT COUNT(DISTINCT o.id)::int AS count
         FROM orders o
         WHERE o."createdAt" BETWEEN $1 AND $2
           AND EXISTS (
             SELECT 1
             FROM farm_assistant_conversation c
             WHERE c."userId" = o."userId"::uuid
               AND c."updatedAt" >= o."createdAt" - INTERVAL '24 hours'
               AND c."updatedAt" <= o."createdAt"
           )`,
        [period.from, period.to],
      ),
    ]);

    const chatsCount = chats[0].count;
    const recsCount = recommendations[0].count;
    const ordersCount = orders[0].count;

    const rate = (numerator: number, denominator: number) =>
      denominator > 0
        ? parseFloat(((numerator / denominator) * 100).toFixed(1))
        : 0;

    return {
      chats: chatsCount,
      recommendations: recsCount,
      recommendationsRate: rate(recsCount, chatsCount),
      // product clicks and add-to-cart require frontend event tracking
      productClicks: null as number | null,
      productClicksRate: null as number | null,
      addToCart: null as number | null,
      addToCartRate: null as number | null,
      orders: ordersCount,
      ordersRate: rate(ordersCount, recsCount),
    };
  }

  // ── top questions ─────────────────────────────────────────────────────────

  async getTopQuestions(from?: string, to?: string, limit = 10) {
    const period = this.parseDateRange(from, to);

    const rows = await this.dataSource.query<
      { content: string; count: number }[]
    >(
      `SELECT content, COUNT(*)::int AS count
       FROM farm_assistant_message
       WHERE role = 'user'
         AND "createdAt" BETWEEN $1 AND $2
       GROUP BY content
       ORDER BY count DESC
       LIMIT $3`,
      [period.from, period.to, limit],
    );

    return rows.map((row, i) => ({
      rank: i + 1,
      question: row.content,
      count: row.count,
    }));
  }

  // ── top recommended categories ────────────────────────────────────────────

  async getTopCategories(from?: string, to?: string) {
    const period = this.parseDateRange(from, to);

    const rows = await this.dataSource.query<
      { category: string; count: number }[]
    >(
      `SELECT elem->>'category' AS category, COUNT(*)::int AS count
       FROM farm_assistant_message,
            jsonb_array_elements(metadata->'suggestedProducts') AS elem
       WHERE role = 'assistant'
         AND metadata->'suggestedProducts' IS NOT NULL
         AND jsonb_typeof(metadata->'suggestedProducts') = 'array'
         AND elem->>'category' IS NOT NULL
         AND "createdAt" BETWEEN $1 AND $2
       GROUP BY elem->>'category'
       ORDER BY count DESC`,
      [period.from, period.to],
    );

    const total = rows.reduce((sum, r) => sum + r.count, 0);

    return rows.map((row) => ({
      category: row.category,
      count: row.count,
      percentage:
        total > 0 ? parseFloat(((row.count / total) * 100).toFixed(1)) : 0,
    }));
  }

  // ── top products recommended ──────────────────────────────────────────────

  async getTopProducts(from?: string, to?: string, limit = 10) {
    const period = this.parseDateRange(from, to);

    const rows = await this.dataSource.query<
      { product_location_id: string; name: string; recommendations: number }[]
    >(
      `SELECT elem->>'id'   AS product_location_id,
              elem->>'name' AS name,
              COUNT(*)::int AS recommendations
       FROM farm_assistant_message,
            jsonb_array_elements(metadata->'suggestedProducts') AS elem
       WHERE role = 'assistant'
         AND metadata->'suggestedProducts' IS NOT NULL
         AND jsonb_typeof(metadata->'suggestedProducts') = 'array'
         AND "createdAt" BETWEEN $1 AND $2
       GROUP BY elem->>'id', elem->>'name'
       ORDER BY recommendations DESC
       LIMIT $3`,
      [period.from, period.to, limit],
    );

    // Correlate with orders placed within 24 h of an AI conversation where
    // the same product location was recommended
    const enriched = await Promise.all(
      rows.map(async (row) => {
        const orderRows = await this.dataSource.query<{ count: number }[]>(
          `SELECT COUNT(DISTINCT o.id)::int AS count
           FROM orders o
           WHERE o."createdAt" BETWEEN $1 AND $2
             AND o.items::jsonb @> $3::jsonb
             AND EXISTS (
               SELECT 1
               FROM farm_assistant_conversation c
               WHERE c."userId" = o."userId"::uuid
                 AND c."updatedAt" >= o."createdAt" - INTERVAL '24 hours'
                 AND c."updatedAt" <= o."createdAt"
             )`,
          [
            period.from,
            period.to,
            JSON.stringify([{ id: row.product_location_id }]),
          ],
        );

        return {
          productLocationId: row.product_location_id,
          name: row.name,
          recommendations: row.recommendations,
          orders: orderRows[0].count,
        };
      }),
    );

    return enriched;
  }

  // ── health & disease alerts ───────────────────────────────────────────────

  async getHealthAlerts(from?: string, to?: string) {
    const period = this.parseDateRange(from, to);

    const alertCounts = await Promise.all(
      DISEASE_KEYWORDS.map(async (disease) => {
        const params: (Date | string)[] = [period.from, period.to];
        const conditions = disease.keywords
          .map((k, i) => {
            params.push(`%${k}%`);
            return `LOWER(content) LIKE $${i + 3}`;
          })
          .join(' OR ');

        const result = await this.dataSource.query<{ count: number }[]>(
          `SELECT COUNT(DISTINCT "conversationId")::int AS count
           FROM farm_assistant_message
           WHERE role = 'user'
             AND "createdAt" BETWEEN $1 AND $2
             AND (${conditions})`,
          params,
        );

        return { label: disease.label, count: result[0].count };
      }),
    );

    const vetResult = await this.dataSource.query<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count
       FROM farm_assistant_message
       WHERE role = 'assistant'
         AND (metadata->>'requiresVetAttention')::boolean = true
         AND "createdAt" BETWEEN $1 AND $2`,
      [period.from, period.to],
    );

    return {
      alerts: alertCounts,
      vetEscalations: vetResult[0].count,
    };
  }

  // ── user satisfaction ─────────────────────────────────────────────────────

  async getSatisfaction(from?: string, to?: string) {
    const period = this.parseDateRange(from, to);

    const [feedback, latency] = await Promise.all([
      this.dataSource.query<{ positive: number; negative: number }[]>(
        `SELECT
           SUM(CASE WHEN rating = 'positive' THEN 1 ELSE 0 END)::int AS positive,
           SUM(CASE WHEN rating = 'negative' THEN 1 ELSE 0 END)::int AS negative
         FROM farm_assistant_feedback
         WHERE "createdAt" BETWEEN $1 AND $2`,
        [period.from, period.to],
      ),
      this.dataSource.query<{ avg_ms: number | null }[]>(
        `SELECT AVG((metadata->>'latencyMs')::float) AS avg_ms
         FROM farm_assistant_message
         WHERE role = 'assistant'
           AND metadata->>'latencyMs' IS NOT NULL
           AND "createdAt" BETWEEN $1 AND $2`,
        [period.from, period.to],
      ),
    ]);

    const positive = feedback[0].positive ?? 0;
    const negative = feedback[0].negative ?? 0;
    const total = positive + negative;
    const satisfactionRate =
      total > 0 ? parseFloat(((positive / total) * 100).toFixed(1)) : null;

    return {
      positive,
      negative,
      satisfactionRate,
      avgResponseTimeMs: latency[0].avg_ms
        ? parseFloat(Number(latency[0].avg_ms).toFixed(0))
        : null,
    };
  }

  async resetUserTokens(
    userId: string,
    adminId: string,
  ): Promise<{ userId: string; newLimit: number; bonusTokens: number }> {
    let quota = await this.quotaRepository.findOne({ where: { userId } });
    if (!quota) {
      quota = this.quotaRepository.create({
        userId,
        bonusTokens: 0,
        lastResetBy: null,
      });
    }
    quota.bonusTokens += TOKEN_LIMIT_PER_USER;
    quota.lastResetBy = adminId;
    await this.quotaRepository.save(quota);
    return {
      userId,
      bonusTokens: quota.bonusTokens,
      newLimit: TOKEN_LIMIT_PER_USER + quota.bonusTokens,
    };
  }

  // ── resource consumption ──────────────────────────────────────────────────

  async getUserTokenUsage(params: {
    page?: number;
    limit?: number;
    search?: string;
    status?: 'exhausted' | 'active';
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const offset = (page - 1) * limit;

    const filters: string[] = [];
    const args: unknown[] = [];

    if (params.search) {
      args.push(`%${params.search.trim()}%`);
      const p = `$${args.length}`;
      filters.push(
        `(u.firstname ILIKE ${p} OR u.lastname ILIKE ${p} OR u.email ILIKE ${p} OR u.phone ILIKE ${p})`,
      );
    }

    if (params.status === 'exhausted') {
      filters.push(
        `usage.tokens >= (${TOKEN_LIMIT_PER_USER} + COALESCE(q."bonusTokens", 0))`,
      );
    } else if (params.status === 'active') {
      filters.push(
        `usage.tokens < (${TOKEN_LIMIT_PER_USER} + COALESCE(q."bonusTokens", 0))`,
      );
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const baseCte = `
      WITH usage AS (
        SELECT
          conv."userId" AS user_id,
          COALESCE(
            SUM(
              (msg.metadata->>'inputTokens')::bigint
              + (msg.metadata->>'outputTokens')::bigint
            ),
            0
          )::bigint AS tokens,
          COUNT(DISTINCT conv.id)::int AS conversations,
          MAX(msg."createdAt") AS last_active
        FROM farm_assistant_message msg
        JOIN farm_assistant_conversation conv ON conv.id = msg."conversationId"
        WHERE msg.role = 'assistant'
          AND msg.metadata->>'inputTokens' IS NOT NULL
        GROUP BY conv."userId"
      )`;

    const countArgs = [...args];
    const countRows = await this.dataSource.query<{ total: string }[]>(
      `${baseCte}
       SELECT COUNT(*)::int AS total
       FROM usage
       LEFT JOIN "user" u ON u.id = usage.user_id
       LEFT JOIN ai_user_quota q ON q."userId" = usage.user_id
       ${whereClause}`,
      countArgs,
    );
    const totalItems = Number(countRows[0]?.total ?? 0);

    const dataArgs = [...args, limit, offset];
    const rows = await this.dataSource.query<
      {
        user_id: string;
        firstname: string | null;
        lastname: string | null;
        email: string | null;
        phone: string | null;
        tokens: string;
        conversations: number;
        last_active: string | null;
        bonus_tokens: string | null;
      }[]
    >(
      `${baseCte}
       SELECT
         usage.user_id,
         u.firstname,
         u.lastname,
         u.email,
         u.phone,
         usage.tokens,
         usage.conversations,
         usage.last_active,
         COALESCE(q."bonusTokens", 0) AS bonus_tokens
       FROM usage
       LEFT JOIN "user" u ON u.id = usage.user_id
       LEFT JOIN ai_user_quota q ON q."userId" = usage.user_id
       ${whereClause}
       ORDER BY usage.tokens DESC
       LIMIT $${dataArgs.length - 1} OFFSET $${dataArgs.length}`,
      dataArgs,
    );

    const data = rows.map((r) => {
      const tokensUsed = Number(r.tokens);
      const bonusTokens = Number(r.bonus_tokens ?? 0);
      const effectiveLimit = TOKEN_LIMIT_PER_USER + bonusTokens;
      const name =
        [r.firstname, r.lastname].filter(Boolean).join(' ').trim() ||
        r.email ||
        r.phone ||
        'Unknown user';
      return {
        userId: r.user_id,
        name,
        email: r.email,
        phone: r.phone,
        tokensUsed,
        tokenLimit: effectiveLimit,
        bonusTokens,
        tokensRemaining: Math.max(0, effectiveLimit - tokensUsed),
        usagePercent: parseFloat(
          ((tokensUsed / effectiveLimit) * 100).toFixed(1),
        ),
        trialExhausted: tokensUsed >= effectiveLimit,
        conversations: r.conversations,
        lastActive: r.last_active,
      };
    });

    return {
      data,
      meta: {
        totalItems,
        currentPage: page,
        itemsPerPage: limit,
        totalPages: Math.ceil(totalItems / limit),
        tokenLimit: TOKEN_LIMIT_PER_USER,
      },
    };
  }

  async getResourceConsumption(from?: string, to?: string) {
    const period = this.parseDateRange(from, to);
    const prev = this.previousPeriod(period.from, period.to);
    const settings = await this.aiSettingsService.getSettings();

    const query = (f: Date, t: Date) =>
      this.dataSource.query<
        {
          input_tokens: string;
          output_tokens: string;
          total_requests: number;
        }[]
      >(
        `SELECT
           COALESCE(SUM((metadata->>'inputTokens')::bigint), 0)::bigint  AS input_tokens,
           COALESCE(SUM((metadata->>'outputTokens')::bigint), 0)::bigint AS output_tokens,
           COUNT(*)::int                                                  AS total_requests
         FROM farm_assistant_message
         WHERE role = 'assistant'
           AND metadata->>'inputTokens' IS NOT NULL
           AND "createdAt" BETWEEN $1 AND $2`,
        [f, t],
      );

    const [current, previous, dailyRows, chatsRow] = await Promise.all([
      query(period.from, period.to),
      query(prev.from, prev.to),
      this.dataSource.query<{ date: string; tokens: string }[]>(
        `SELECT
           DATE_TRUNC('day', "createdAt") AS date,
           COALESCE(
             SUM((metadata->>'inputTokens')::bigint + (metadata->>'outputTokens')::bigint),
             0
           )::bigint AS tokens
         FROM farm_assistant_message
         WHERE role = 'assistant'
           AND metadata->>'inputTokens' IS NOT NULL
           AND "createdAt" BETWEEN $1 AND $2
         GROUP BY DATE_TRUNC('day', "createdAt")
         ORDER BY date ASC`,
        [period.from, period.to],
      ),
      this.dataSource.query<{ count: number }[]>(
        `SELECT COUNT(*)::int AS count
         FROM farm_assistant_conversation
         WHERE "createdAt" BETWEEN $1 AND $2`,
        [period.from, period.to],
      ),
    ]);

    const inputTokens = Number(current[0].input_tokens);
    const outputTokens = Number(current[0].output_tokens);
    const totalTokens = inputTokens + outputTokens;
    const totalRequests = current[0].total_requests;
    const totalChats = chatsRow[0].count;

    const rateIn = Number(settings.costPer1MInputTokensUSD);
    const rateOut = Number(settings.costPer1MOutputTokensUSD);
    const totalCostUSD =
      (inputTokens / 1_000_000) * rateIn + (outputTokens / 1_000_000) * rateOut;
    const avgCostPerChatUSD = totalChats > 0 ? totalCostUSD / totalChats : 0;

    const prevInput = Number(previous[0].input_tokens);
    const prevOutput = Number(previous[0].output_tokens);
    const prevTotal = prevInput + prevOutput;
    const prevCost =
      (prevInput / 1_000_000) * rateIn + (prevOutput / 1_000_000) * rateOut;

    const budgetUsedPercent = settings.monthlyBudgetUSD
      ? parseFloat(
          ((totalCostUSD / Number(settings.monthlyBudgetUSD)) * 100).toFixed(1),
        )
      : null;

    return {
      provider: settings.provider,
      model: settings.model,
      monthlyBudgetUSD: settings.monthlyBudgetUSD
        ? Number(settings.monthlyBudgetUSD)
        : null,
      totalTokens,
      inputTokens,
      outputTokens,
      totalRequests,
      totalCostUSD: parseFloat(totalCostUSD.toFixed(4)),
      avgCostPerChatUSD: parseFloat(avgCostPerChatUSD.toFixed(6)),
      budgetUsedPercent,
      dailyUsage: dailyRows.map((r) => ({
        date: r.date,
        tokens: Number(r.tokens),
      })),
      change: {
        totalTokens: this.pct(totalTokens, prevTotal),
        totalCostUSD: this.pct(totalCostUSD, prevCost),
      },
    };
  }

  // ── bird type breakdown ───────────────────────────────────────────────────

  async getBirdTypeBreakdown(from?: string, to?: string) {
    const period = this.parseDateRange(from, to);

    const rows = await this.dataSource.query<
      { bird_type: string; count: number }[]
    >(
      `SELECT COALESCE("farmContext"->>'birdType', 'Unknown') AS bird_type,
              COUNT(*)::int AS count
       FROM farm_assistant_conversation
       WHERE "createdAt" BETWEEN $1 AND $2
       GROUP BY "farmContext"->>'birdType'
       ORDER BY count DESC`,
      [period.from, period.to],
    );

    const total = rows.reduce((sum, r) => sum + r.count, 0);

    return rows.map((row) => ({
      birdType: row.bird_type,
      count: row.count,
      percentage:
        total > 0 ? parseFloat(((row.count / total) * 100).toFixed(1)) : 0,
    }));
  }
}
