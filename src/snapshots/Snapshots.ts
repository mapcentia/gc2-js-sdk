/**
 * @author     Martin Høgh <mh@mapcentia.com>
 * @copyright  2013-2026 MapCentia ApS
 * @license    https://opensource.org/license/mit  The MIT License
 */

import type { CentiaHttpClient } from '../http/client';

/** Status of a snapshot job. */
export type SnapshotStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'superseded';

/** A snapshot output format id. Known ids: `parquet`, `flatgeobuf` — extensible server-side. */
export type SnapshotFormat = 'parquet' | 'flatgeobuf' | (string & {});

/** A snapshot date (`YYYY-MM-DD`), or `latest` for the newest published snapshot. */
export type SnapshotDate = 'latest' | (string & {});

/**
 * One output format of a snapshot and what became of it: `requested` before
 * the worker ran, then `produced` (with file, size and media type) or
 * `skipped` (with a reason, e.g. a geometry-only format on a relation
 * without geometry).
 */
export interface SnapshotFormatResult {
  format: SnapshotFormat;
  status: 'requested' | 'produced' | 'skipped';
  /** Produced only: file name in the snapshot directory. */
  file?: string;
  /** Produced only. */
  size_bytes?: number;
  /** Produced only. */
  media_type?: string;
  /** Skipped only: why this format could not be produced. */
  reason?: string;
  /** Produced only, and only in the relation snapshot read API: where to download this format. */
  href?: string;
}

/** A request to snapshot a table or view to S3. */
export interface SnapshotRequest {
  /** Schema of the relation. */
  schema: string;
  /** Table or view name. */
  relation: string;
  /** Optional EPSG code to reproject to. Omit to keep the native SRID. */
  srs?: number;
  /**
   * Output formats to produce, in order. Omit to use the server default
   * (usually `['parquet']`). Must be non-empty and free of duplicates; a
   * geometry-only format (FlatGeobuf) is skipped with a reason for a
   * relation without geometry — unless every requested format needs one,
   * which is refused up front (400).
   */
  formats?: SnapshotFormat[];
}

/** 202 response from postSnapshot; poll `_links.self` (or getSnapshot) for status. */
export interface SnapshotAccepted {
  id: string;
  status: 'pending';
  _links: { self: string };
}

/** One column of the relation at snapshot time. */
export interface SnapshotColumn {
  column_name: string;
  data_type: string;
}

/** Status of a snapshot job. */
export interface SnapshotJob {
  id: string;
  schema: string;
  relation: string;
  srs: number | null;
  status: SnapshotStatus;
  /** UTC date the export ran; the {date} segment of the relation snapshot read API. */
  snapshot_date: string | null;
  s3_path: string | null;
  row_count: number | null;
  /** md5 fingerprint of relation_schema, for drift detection. */
  schema_version: string | null;
  relation_schema: SnapshotColumn[] | null;
  error: string | null;
  username: string;
  created: string;
  started: string | null;
  finished: string | null;
  /** One entry per requested output format and its outcome. */
  formats: SnapshotFormatResult[];
}

/** Status of a rewrite of the snapshot STAC catalog. */
export type SnapshotCatalogRebuildStatus = 'pending' | 'running' | 'succeeded' | 'failed';

/** 202 response from postSnapshotCatalogRebuild; poll `_links.self` (or getSnapshotCatalogRebuild) for status. */
export interface SnapshotCatalogRebuildAccepted {
  id: string;
  status: 'pending';
  _links: { self: string };
}

/** Status of a rewrite of the snapshot STAC catalog. */
export interface SnapshotCatalogRebuild {
  id: string;
  status: SnapshotCatalogRebuildStatus;
  /** Number of catalog documents the rewrite covered; null until it has run. */
  documents: number | null;
  /** Number of those that could not be written; a `failed` rebuild still wrote the rest. */
  failed_documents: number | null;
  error: string | null;
  username: string;
  created: string;
  started: string | null;
  finished: string | null;
}

/** One file of a published snapshot. */
export interface RelationSnapshotFile {
  name: string;
  size_bytes: number;
  href: string;
}

/** A published snapshot of a relation, as returned by the list endpoint. */
export interface RelationSnapshot {
  snapshot_date: string;
  snapshot_id: string;
  row_count: number;
  size_bytes: number;
  schema_version: string;
  files: RelationSnapshotFile[];
  published: string;
  /** One entry per requested output format; a produced one carries its `href` under `/data/{format}`. */
  formats: SnapshotFormatResult[];
}

/** One published snapshot with full metadata, as returned by the single-date endpoint. */
export interface RelationSnapshotDetails extends RelationSnapshot {
  srs: number | null;
  relation_schema: SnapshotColumn[] | null;
  crs: string | null;
  /** `latest` is the fixed URL that always resolves to the newest published snapshot. */
  _links: { data: string; files: { name: string; href: string }[]; latest?: string };
}

/** Filters for getSnapshots. */
export interface GetSnapshotsOptions {
  schema?: string;
  relation?: string;
}

/** Polling options for waitForSnapshot and waitForSnapshotCatalogRebuild. */
export interface WaitForSnapshotOptions {
  /** Milliseconds between polls. Default 2000. */
  intervalMs?: number;
  /** Give up after this many milliseconds. Default 300000 (5 minutes). */
  timeoutMs?: number;
}

/** Options for the snapshot data/file download methods. */
export interface SnapshotDataOptions {
  /** Inclusive byte range to request, e.g. `[0, 1023]` for the first KiB. */
  range?: [number, number];
}

/**
 * Client for the snapshot API: GeoParquet exports of a relation.
 *
 * The job API (`/api/v4/snapshots`) queues and inspects exports and is
 * super-user only; exports run asynchronously — poll with `getSnapshot` or
 * use `waitForSnapshot`. The read API
 * (`/api/v4/schemas/{schema}/relations/{relation}/snapshots`) serves the
 * published snapshots to any user with read access to the relation, with
 * HEAD + byte-range support so Parquet readers can fetch footers and row
 * groups selectively.
 *
 * ```ts
 * const snapshots = new Snapshots(createCentiaClient({ baseUrl, auth }));
 * const { id } = await snapshots.postSnapshot({ schema: 'geodanmark', relation: 'bygning' });
 * const done = await snapshots.waitForSnapshot(id);
 * ```
 */
export class Snapshots {
  constructor(private readonly client: CentiaHttpClient) {}

  private relationPath(schema: string, relation: string, rest = ''): string {
    return `api/v4/schemas/${encodeURIComponent(schema)}/relations/${encodeURIComponent(relation)}/snapshots${rest}`;
  }

  /**
   * Queue Parquet snapshots of one or more tables or views (an array returns
   * an array, in request order; all-or-nothing). Returns 202 with the job
   * id(s). Throws `CentiaApiError`: 400 (duplicates or an empty list),
   * 403 (super-user only), 404 (relation not found), 409 (a snapshot of a
   * relation is already pending or running), 501 (storage not configured).
   */
  async postSnapshot(body: SnapshotRequest): Promise<SnapshotAccepted>;
  async postSnapshot(body: SnapshotRequest[]): Promise<SnapshotAccepted[]>;
  async postSnapshot(body: SnapshotRequest | SnapshotRequest[]): Promise<SnapshotAccepted | SnapshotAccepted[]> {
    return this.client.request({
      path: 'api/v4/snapshots',
      method: 'POST',
      body,
      expectedStatus: 202,
    });
  }

  /**
   * Get one snapshot job by id, or several (an array returns an array).
   * Throws a 404 `CentiaApiError` when any id is unknown. Super-user only.
   */
  async getSnapshot(id: string): Promise<SnapshotJob>;
  async getSnapshot(ids: string[]): Promise<SnapshotJob[]>;
  async getSnapshot(id: string | string[]): Promise<SnapshotJob | SnapshotJob[]> {
    const keys = Array.isArray(id) ? id : [id];
    return this.client.request({
      path: `api/v4/snapshots/${keys.map((k) => encodeURIComponent(k)).join(',')}`,
      method: 'GET',
    });
  }

  /** List the newest snapshot jobs (50), optionally filtered by schema/relation. Super-user only. */
  async getSnapshots(options?: GetSnapshotsOptions): Promise<SnapshotJob[]> {
    const query: Record<string, string> = {};
    if (options?.schema !== undefined) query.schema = options.schema;
    if (options?.relation !== undefined) query.relation = options.relation;
    return this.client.request({
      path: 'api/v4/snapshots',
      method: 'GET',
      query: Object.keys(query).length > 0 ? query : undefined,
    });
  }

  /**
   * Poll a snapshot job until it reaches a terminal status (succeeded, failed
   * or superseded) and return it — check `status`/`error` on the result.
   * Throws an `Error` when `timeoutMs` elapses first.
   */
  async waitForSnapshot(id: string, options?: WaitForSnapshotOptions): Promise<SnapshotJob> {
    const intervalMs = options?.intervalMs ?? 2000;
    const timeoutMs = options?.timeoutMs ?? 300000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const job = await this.getSnapshot(id);
      if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'superseded') {
        return job;
      }
      if (Date.now() + intervalMs > deadline) {
        throw new Error(`Timed out after ${timeoutMs} ms waiting for snapshot ${id} (status: ${job.status})`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  /**
   * Queue a rewrite of the database's whole STAC catalog of snapshots
   * (`catalog.json` and every `collection.json`, `latest.json` and
   * `item.json`). Publishing a snapshot already updates the documents of its
   * own relation, so this is a repair tool: for a catalog that has drifted,
   * or after a server upgrade that changes the document layout. It takes
   * longer the more snapshots are published, and queued snapshots on the
   * server wait while it runs. Returns 202 with the rebuild id. Throws
   * `CentiaApiError`: 403 (super-user only), 409 `CATALOG_REBUILD_IN_PROGRESS`
   * (one is already pending or running), 501 (storage not configured).
   */
  async postSnapshotCatalogRebuild(): Promise<SnapshotCatalogRebuildAccepted> {
    return this.client.request({
      path: 'api/v4/snapshots/catalog/rebuilds',
      method: 'POST',
      expectedStatus: 202,
    });
  }

  /**
   * Get one catalog rebuild by id, or several (an array returns an array).
   * Throws a 404 `CentiaApiError` when any id is unknown. Super-user only.
   */
  async getSnapshotCatalogRebuild(id: string): Promise<SnapshotCatalogRebuild>;
  async getSnapshotCatalogRebuild(ids: string[]): Promise<SnapshotCatalogRebuild[]>;
  async getSnapshotCatalogRebuild(id: string | string[]): Promise<SnapshotCatalogRebuild | SnapshotCatalogRebuild[]> {
    const keys = Array.isArray(id) ? id : [id];
    return this.client.request({
      path: `api/v4/snapshots/catalog/rebuilds/${keys.map((k) => encodeURIComponent(k)).join(',')}`,
      method: 'GET',
    });
  }

  /** List the newest catalog rebuilds (50). Super-user only. */
  async getSnapshotCatalogRebuilds(): Promise<SnapshotCatalogRebuild[]> {
    return this.client.request({
      path: 'api/v4/snapshots/catalog/rebuilds',
      method: 'GET',
    });
  }

  /**
   * Poll a catalog rebuild until it has succeeded or failed and return it —
   * check `status`/`failed_documents`/`error` on the result. Throws an
   * `Error` when `timeoutMs` elapses first; a large catalog can take longer
   * than the default five minutes.
   */
  async waitForSnapshotCatalogRebuild(id: string, options?: WaitForSnapshotOptions): Promise<SnapshotCatalogRebuild> {
    const intervalMs = options?.intervalMs ?? 2000;
    const timeoutMs = options?.timeoutMs ?? 300000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const rebuild = await this.getSnapshotCatalogRebuild(id);
      if (rebuild.status === 'succeeded' || rebuild.status === 'failed') {
        return rebuild;
      }
      if (Date.now() + intervalMs > deadline) {
        throw new Error(`Timed out after ${timeoutMs} ms waiting for catalog rebuild ${id} (status: ${rebuild.status})`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  /** List the published snapshots of a relation, newest first. */
  async getRelationSnapshots(schema: string, relation: string): Promise<RelationSnapshot[]> {
    return this.client.request({
      path: this.relationPath(schema, relation),
      method: 'GET',
    });
  }

  /**
   * Get one published snapshot (metadata) by date (`YYYY-MM-DD`), or pass
   * `latest` for the newest published snapshot — `latest` works the same
   * way in every data/file method and URL builder. The response still
   * carries the real `snapshot_date` and dated hrefs, plus `_links.latest`.
   */
  async getRelationSnapshot(schema: string, relation: string, date: SnapshotDate): Promise<RelationSnapshotDetails> {
    return this.client.request({
      path: this.relationPath(schema, relation, `/${encodeURIComponent(date)}`),
      method: 'GET',
    });
  }

  /**
   * Absolute URL of the snapshot's Parquet file, without fetching it — for
   * DuckDB/GDAL or a plain fetch. Authorization travels in the request
   * header, so protected relations need the caller to attach the token.
   */
  getRelationSnapshotDataUrl(schema: string, relation: string, date: SnapshotDate): string {
    return `${this.client.baseUrl}/${this.relationPath(schema, relation, `/${encodeURIComponent(date)}/data`)}`;
  }

  /**
   * Fetch the snapshot's Parquet file and return the raw `Response` (stream
   * or buffer it yourself). Follows the 302 redirect the server answers in
   * redirect mode. Pass `range` for a single byte range (206). Throws
   * `CentiaApiError`: 403, 404, 409 (several files; use
   * getRelationSnapshotFile), 416, 502.
   */
  async getRelationSnapshotData(
    schema: string,
    relation: string,
    date: SnapshotDate,
    options?: SnapshotDataOptions,
  ): Promise<Response> {
    return this.rawGet(this.relationPath(schema, relation, `/${encodeURIComponent(date)}/data`), 'GET', options);
  }

  /** HEAD request for the snapshot's Parquet file — Content-Length, Accept-Ranges and ETag without the body. */
  async headRelationSnapshotData(schema: string, relation: string, date: SnapshotDate): Promise<Response> {
    return this.rawGet(this.relationPath(schema, relation, `/${encodeURIComponent(date)}/data`), 'HEAD');
  }

  /**
   * Absolute URL of one output format of the snapshot, without fetching it —
   * for DuckDB/GDAL or a plain fetch.
   */
  getRelationSnapshotDataFormatUrl(schema: string, relation: string, date: SnapshotDate, format: SnapshotFormat): string {
    return `${this.client.baseUrl}/${this.relationPath(schema, relation, `/${encodeURIComponent(date)}/data/${encodeURIComponent(format)}`)}`;
  }

  /**
   * Fetch one output format of the snapshot (Content-Type is the format's
   * media type). Same redirect/range semantics as getRelationSnapshotData.
   * Throws `CentiaApiError`: 400 (unknown format id), 404 (no snapshot for
   * that date, or the format was skipped/not requested), 403, 416, 502.
   */
  async getRelationSnapshotDataFormat(
    schema: string,
    relation: string,
    date: SnapshotDate,
    format: SnapshotFormat,
    options?: SnapshotDataOptions,
  ): Promise<Response> {
    return this.rawGet(
      this.relationPath(schema, relation, `/${encodeURIComponent(date)}/data/${encodeURIComponent(format)}`),
      'GET',
      options,
    );
  }

  /** HEAD request for one output format of the snapshot. */
  async headRelationSnapshotDataFormat(schema: string, relation: string, date: SnapshotDate, format: SnapshotFormat): Promise<Response> {
    return this.rawGet(
      this.relationPath(schema, relation, `/${encodeURIComponent(date)}/data/${encodeURIComponent(format)}`),
      'HEAD',
    );
  }

  /**
   * Fetch one file of the snapshot by catalog name (`data-<id>.parquet`,
   * `metadata-<id>.json`). Same redirect/range semantics as
   * getRelationSnapshotData.
   */
  async getRelationSnapshotFile(
    schema: string,
    relation: string,
    date: SnapshotDate,
    file: string,
    options?: SnapshotDataOptions,
  ): Promise<Response> {
    return this.rawGet(
      this.relationPath(schema, relation, `/${encodeURIComponent(date)}/files/${encodeURIComponent(file)}`),
      'GET',
      options,
    );
  }

  /** HEAD request for one file of the snapshot. */
  async headRelationSnapshotFile(schema: string, relation: string, date: SnapshotDate, file: string): Promise<Response> {
    return this.rawGet(
      this.relationPath(schema, relation, `/${encodeURIComponent(date)}/files/${encodeURIComponent(file)}`),
      'HEAD',
    );
  }

  private async rawGet(path: string, method: 'GET' | 'HEAD', options?: SnapshotDataOptions): Promise<Response> {
    const headers: Record<string, string> = {};
    if (options?.range) {
      headers['Range'] = `bytes=${options.range[0]}-${options.range[1]}`;
    }
    return this.client.requestRaw({
      path,
      method,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      expectedStatus: [200, 206],
    });
  }
}
