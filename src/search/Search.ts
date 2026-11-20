/**
 * @author     Martin Høgh <mh@mapcentia.com>
 * @copyright  2013-2026 MapCentia ApS
 * @license    https://opensource.org/license/mit  The MIT License
 */

import type { CentiaHttpClient } from '../http/client';
import type { GeoJsonGeometry } from '../features/Features';

/**
 * OpenSearch URI-search parameters. The query string is passed to OpenSearch
 * `_search` unaltered, so any `_search` URI parameter works; the common ones
 * are typed. `undefined` values are dropped.
 */
export interface SearchParams {
  /** Lucene query string. Attribute fields are addressed as `properties.<column>`. */
  q?: string;
  /** Max number of hits to return. Defaults to 10. */
  size?: number;
  /** Offset of the first hit (paging). Defaults to 0. */
  from?: number;
  /** Comma-separated `<field>:<asc|desc>` pairs, e.g. `properties.name.keyword:asc`. */
  sort?: string;
  /** Comma-separated list of `_source` fields to return, or `false` to omit `_source`. */
  _source?: string | false;
  /** Default operator for `q`. Defaults to OR. */
  default_operator?: 'AND' | 'OR';
  /** Default field for `q` when no field prefix is given. */
  df?: string;
  [param: string]: string | number | boolean | undefined;
}

/**
 * An OpenSearch query DSL body. Passed to OpenSearch `_search` unaltered, so
 * any `_search` body is accepted; the common members are typed.
 */
export interface SearchQuery {
  /** OpenSearch query DSL. Attribute fields are addressed as `properties.<column>`. */
  query?: Record<string, unknown>;
  /** Max number of hits to return. Defaults to 10. */
  size?: number;
  /** Offset of the first hit (paging). Defaults to 0. */
  from?: number;
  /** Sort clauses, e.g. `[{ 'properties.name.keyword': 'asc' }]`. */
  sort?: unknown[];
  /** Restrict the returned `_source` fields, or `false` to omit `_source`. */
  _source?: boolean | string[];
  /** OpenSearch aggregations. */
  aggs?: Record<string, unknown>;
  /** OpenSearch highlighting. */
  highlight?: Record<string, unknown>;
  [member: string]: unknown;
}

/** The indexed document: GeoJSON-like, with the row's columns in `properties`. */
export interface SearchSource<P = Record<string, unknown>> {
  properties: P;
  geometry?: GeoJsonGeometry | null;
  [key: string]: unknown;
}

/** One matching document. `_source` is absent when the query sets `_source: false`. */
export interface SearchHit<S = SearchSource> {
  /** OpenSearch index name: `<database>_<schema>_<table>`. */
  _index: string;
  /** The row's primary-key value. */
  _id: string;
  /** Null when the query sorts on something other than the score. */
  _score: number | null;
  _source: S;
  [key: string]: unknown;
}

/** The OpenSearch `_search` response, returned unaltered. */
export interface SearchResult<S = SearchSource> {
  /** Search time in milliseconds. */
  took: number;
  timed_out: boolean;
  _shards?: Record<string, unknown>;
  hits: {
    total: { value: number; relation: string };
    max_score: number | null;
    hits: SearchHit<S>[];
  };
  /** Present when the query has `aggs`. */
  aggregations?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Result of (re)building a search index. */
export interface SearchIndexBuildResult {
  /** OpenSearch index name: `<database>_<schema>_<table>`. */
  index: string;
  /** Indexing summary, e.g. "Indexed 42 documents". */
  message: string | null;
  /** True if OpenSearch reported errors for some documents. */
  errors: boolean;
  /** Per-document bulk indexing errors. */
  errors_in?: Record<string, unknown>[];
}

/** Result of dropping a search index. */
export interface SearchIndexDropResult {
  /** OpenSearch index name. */
  index: string;
  dropped: boolean;
}

/** Per-database OpenSearch analysis settings, used as `settings.analysis` when a search index is built. */
export interface SearchSettings {
  /**
   * An OpenSearch index `settings.analysis` block (`analyzer`, `tokenizer`,
   * `filter`, `char_filter`, `normalizer`). Replaces the default block wholesale.
   */
  analysis: Record<string, unknown>;
}

function searchPath(schema: string, table: string): string {
  return `api/v4/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}/search`;
}

/**
 * Client for the Search API: full-text search in a relation's OpenSearch
 * index (`/api/v4/schemas/{schema}/tables/{table}/search`) and the
 * per-database analysis settings (`/api/v4/search/settings`).
 *
 * Searching is open to sub-users with read access to the relation; building
 * and dropping indexes and the settings are for the database owner only.
 *
 * ```ts
 * const search = new Search(createCentiaClient({ baseUrl, auth }));
 * await search.buildSearchIndex('my_schema', 'my_table');
 * const res = await search.searchPost('my_schema', 'my_table', { query: { match: { 'properties.name': 'Findme' } } });
 * ```
 */
export class Search {
  constructor(private readonly client: CentiaHttpClient) {}

  /**
   * Search the relation's index with OpenSearch URI-search parameters, e.g.
   * `{ q: 'properties.name:Findme', size: 20 }`. Without parameters every
   * document matches. Use `searchPost` for a query DSL body.
   * Throws `CentiaApiError`: 400 `SEARCH_ERROR` (invalid query), 403 `INSUFFICIENT_PRIVILEGES` (no read
   * access) or `GEOFENCE_RULES_APPLY` (a deny/limit rule applies to the sub-user), 404 `INDEX_NOT_FOUND`
   * (unknown relation, or no index built).
   */
  async search<S = SearchSource>(schema: string, table: string, params?: SearchParams): Promise<SearchResult<S>> {
    const query: Record<string, string> = {};
    for (const key of Object.keys(params ?? {})) {
      const value = params![key];
      if (value !== undefined) query[key] = String(value);
    }
    return this.client.request({
      path: searchPath(schema, table),
      method: 'GET',
      query: Object.keys(query).length > 0 ? query : undefined,
    });
  }

  /**
   * Search the relation's index with an OpenSearch query DSL body.
   * Throws `CentiaApiError`: 400 `SEARCH_ERROR` (invalid query), 403 `INSUFFICIENT_PRIVILEGES` (no read
   * access) or `GEOFENCE_RULES_APPLY` (a deny/limit rule applies to the sub-user), 404 `INDEX_NOT_FOUND`
   * (unknown relation, or no index built).
   */
  async searchPost<S = SearchSource>(schema: string, table: string, body: SearchQuery): Promise<SearchResult<S>> {
    return this.client.request({
      path: searchPath(schema, table),
      method: 'POST',
      body,
    });
  }

  /**
   * (Re)build the index from the table/view: drops any existing index,
   * creates it with the database's analysis settings and a mapping derived
   * from the columns, bulk indexes all rows and refreshes the index, so it is
   * searchable immediately. The relation must have a primary key. Check
   * `errors` on the result — some documents can fail while the build succeeds.
   * Throws `CentiaApiError`: 400 `INDEX_BUILD_ERROR` (no primary key, or
   * OpenSearch rejected the index), 403 `NOT_OWNER`, 404 (unknown relation).
   */
  async buildSearchIndex(schema: string, table: string): Promise<SearchIndexBuildResult> {
    return this.client.request({
      path: searchPath(schema, table),
      method: 'PUT',
    });
  }

  /**
   * Drop the relation's index. The table itself is not touched.
   * Throws `CentiaApiError`: 403 `NOT_OWNER`, 404 `INDEX_DROP_ERROR`
   * (unknown relation or index).
   */
  async dropSearchIndex(schema: string, table: string): Promise<SearchIndexDropResult> {
    return this.client.request({
      path: searchPath(schema, table),
      method: 'DELETE',
    });
  }

  /**
   * Get the per-database analysis block (the default when none is set).
   * Throws `CentiaApiError`: 403 `NOT_OWNER`.
   */
  async getSearchSettings(): Promise<SearchSettings> {
    return this.client.request({
      path: 'api/v4/search/settings',
      method: 'GET',
    });
  }

  /**
   * Set the per-database analysis block; resolves to the stored block. It
   * applies to indexes built after this call — rebuild existing indexes with
   * `buildSearchIndex` to pick it up.
   * Throws `CentiaApiError`: 400 `INVALID_DATA` (no `analysis` object),
   * 403 `NOT_OWNER`.
   */
  async putSearchSettings(settings: SearchSettings): Promise<SearchSettings> {
    return this.client.request({
      path: 'api/v4/search/settings',
      method: 'PUT',
      body: settings,
    });
  }
}
