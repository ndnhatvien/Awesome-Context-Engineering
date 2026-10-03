/**
 * Lightweight, zero-dependency Supabase Client
 *
 * Communicates with Supabase PostgREST endpoints using native fetch.
 * Fully compatible with Vercel Serverless / Edge / Node runtimes.
 */

import type { SupabaseConfig } from './types.js';

export class SupabaseClient {
  private readonly baseUrl: string;
  private readonly key: string;
  private readonly schema: string;
  private readonly timeoutMs: number;

  constructor(config: SupabaseConfig) {
    if (!config.url || !config.key) {
      throw new Error('SupabaseClient requires both url and key');
    }
    this.baseUrl = config.url.replace(/\/+$/, '');
    this.key = config.key;
    this.schema = config.schema || 'public';
    this.timeoutMs = config.timeoutMs ?? 15000;
  }

  private getHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Profile': this.schema,
      'Content-Profile': this.schema,
      ...extra,
    };
  }

  /**
   * Invokes a PostgreSQL stored procedure / function via Supabase RPC.
   */
  async rpc<T>(functionName: string, params: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}/rest/v1/rpc/${functionName}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(params),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Supabase RPC '${functionName}' failed (${response.status}): ${errorText}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Inserts or upserts rows into a PostgREST table.
   */
  async insert<T>(
    table: string,
    rows: Record<string, unknown>[],
    options?: { upsert?: boolean },
  ): Promise<T[]> {
    if (rows.length === 0) return [];

    const url = `${this.baseUrl}/rest/v1/${table}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();

    const prefer = options?.upsert
      ? 'resolution=merge-duplicates,return=representation'
      : 'return=representation';

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders({ Prefer: prefer }),
        body: JSON.stringify(rows),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Supabase insert into '${table}' failed (${response.status}): ${errorText}`,
        );
      }

      return (await response.json()) as T[];
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Queries rows from a PostgREST table.
   */
  async select<T>(table: string, queryParams: Record<string, string> = {}): Promise<T[]> {
    const searchParams = new URLSearchParams(queryParams);
    const url = `${this.baseUrl}/rest/v1/${table}?${searchParams.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Supabase select from '${table}' failed (${response.status}): ${errorText}`,
        );
      }

      return (await response.json()) as T[];
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Deletes rows matching criteria from a PostgREST table.
   */
  async delete(table: string, queryParams: Record<string, string>): Promise<void> {
    const searchParams = new URLSearchParams(queryParams);
    const url = `${this.baseUrl}/rest/v1/${table}?${searchParams.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();

    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: this.getHeaders(),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Supabase delete from '${table}' failed (${response.status}): ${errorText}`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Counts rows in a table matching filter criteria.
   */
  async count(table: string, queryParams: Record<string, string> = {}): Promise<number> {
    const searchParams = new URLSearchParams({
      ...queryParams,
      select: 'count',
    });
    const url = `${this.baseUrl}/rest/v1/${table}?${searchParams.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        headers: this.getHeaders({ Prefer: 'count=exact' }),
        signal: controller.signal,
      });

      const contentRange = response.headers.get('content-range');
      if (contentRange) {
        const match = contentRange.match(/\/(\d+)$/);
        if (match) return Number.parseInt(match[1], 10);
      }
      return 0;
    } finally {
      clearTimeout(timer);
    }
  }
}
