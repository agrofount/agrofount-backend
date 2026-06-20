import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ChartGranularity } from './dto/ai-analytics-query.dto';

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
  constructor(private readonly dataSource: DataSource) {}

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
         WHERE created_at BETWEEN $1 AND $2`,
        [from, to],
      ),
      this.dataSource.query<{ count: number }[]>(
        `SELECT COUNT(DISTINCT user_id)::int AS count
         FROM farm_assistant_conversation
         WHERE created_at BETWEEN $1 AND $2`,
        [from, to],
      ),
      this.dataSource.query<{ count: number }[]>(
        `SELECT COUNT(*)::int AS count
         FROM farm_assistant_message
         WHERE role = 'assistant'
           AND (metadata->>'requiresVetAttention')::boolean = true
           AND created_at BETWEEN $1 AND $2`,
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
             WHERE c.user_id = o."userId"::uuid
               AND c.updated_at >= o."createdAt" - INTERVAL '24 hours'
               AND c.updated_at <= o."createdAt"
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
      `SELECT DATE_TRUNC($1, created_at) AS date, COUNT(*)::int AS count
       FROM farm_assistant_conversation
       WHERE created_at BETWEEN $2 AND $3
       GROUP BY DATE_TRUNC($1, created_at)
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
         WHERE created_at BETWEEN $1 AND $2`,
        [period.from, period.to],
      ),
      this.dataSource.query<{ count: number }[]>(
        `SELECT COUNT(DISTINCT conversation_id)::int AS count
         FROM farm_assistant_message
         WHERE role = 'assistant'
           AND jsonb_array_length(COALESCE(metadata->'suggestedProducts', '[]'::jsonb)) > 0
           AND created_at BETWEEN $1 AND $2`,
        [period.from, period.to],
      ),
      this.dataSource.query<{ count: number }[]>(
        `SELECT COUNT(DISTINCT o.id)::int AS count
         FROM orders o
         WHERE o."createdAt" BETWEEN $1 AND $2
           AND EXISTS (
             SELECT 1
             FROM farm_assistant_conversation c
             WHERE c.user_id = o."userId"::uuid
               AND c.updated_at >= o."createdAt" - INTERVAL '24 hours'
               AND c.updated_at <= o."createdAt"
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
         AND created_at BETWEEN $1 AND $2
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
         AND created_at BETWEEN $1 AND $2
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
         AND created_at BETWEEN $1 AND $2
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
             AND o.items @> $3
             AND EXISTS (
               SELECT 1
               FROM farm_assistant_conversation c
               WHERE c.user_id = o."userId"::uuid
                 AND c.updated_at >= o."createdAt" - INTERVAL '24 hours'
                 AND c.updated_at <= o."createdAt"
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
          `SELECT COUNT(DISTINCT conversation_id)::int AS count
           FROM farm_assistant_message
           WHERE role = 'user'
             AND created_at BETWEEN $1 AND $2
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
         AND created_at BETWEEN $1 AND $2`,
      [period.from, period.to],
    );

    return {
      alerts: alertCounts,
      vetEscalations: vetResult[0].count,
    };
  }

  // ── user satisfaction ─────────────────────────────────────────────────────

  async getSatisfaction(_from?: string, _to?: string) {
    // Satisfaction requires explicit thumbs-up / thumbs-down feedback which is
    // not yet stored. Return a zero-state so the frontend can render the widget
    // gracefully until a feedback entity is added.
    return {
      positive: 0,
      negative: 0,
      satisfactionRate: null as number | null,
      avgResponseTimeMs: null as number | null,
    };
  }

  // ── bird type breakdown ───────────────────────────────────────────────────

  async getBirdTypeBreakdown(from?: string, to?: string) {
    const period = this.parseDateRange(from, to);

    const rows = await this.dataSource.query<
      { bird_type: string; count: number }[]
    >(
      `SELECT COALESCE(farm_context->>'birdType', 'Unknown') AS bird_type,
              COUNT(*)::int AS count
       FROM farm_assistant_conversation
       WHERE created_at BETWEEN $1 AND $2
       GROUP BY farm_context->>'birdType'
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
