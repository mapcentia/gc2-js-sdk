/**
 * @author     Martin Høgh <mh@mapcentia.com>
 * @copyright  2013-2026 MapCentia ApS
 * @license    https://opensource.org/license/mit  The MIT License
 */

import type { CentiaHttpClient } from '../http/client';
import type { LocationResponse } from '../provisioning/types';

/**
 * Workflow role of a sub-user on a table.
 * - `author`: edits become drafts.
 * - `reviewer`: edits and approvals count as reviewed.
 * - `publisher`: edits and approvals are published.
 * - `none`: no part in the workflow; sees published features only and cannot edit the table.
 */
export type WorkflowRoleName = 'none' | 'author' | 'reviewer' | 'publisher';

/** The workflow role of one sub-user on a table. */
export interface WorkflowRole {
  /** Sub-user name. */
  subuser: string;
  role: WorkflowRoleName;
}

/** Where one feature stands in the workflow of its table: its latest logged step. */
export interface WorkflowItem {
  /** Schema of the feature's table. Absent from servers that predate the workflow log. */
  schema?: string;
  /** The feature's table. Absent from servers that predate the workflow log. */
  table?: string;
  /** The feature's primary key value; the id of the item. */
  gid: number;
  /** The feature's version id (gc2_version_gid), the same across all versions of the feature. */
  version_gid: number;
  /** 1 drafted, 2 reviewed, 3 published. */
  status: 1 | 2 | 3;
  status_name: 'drafted' | 'reviewed' | 'published';
  /** What the latest step was. */
  operation: 'insert' | 'update' | 'delete';
  /** Who made the latest step. */
  user: string;
  /** Who signed as author, or null. */
  author: string | null;
  /** Who signed as reviewer, or null. */
  reviewer: string | null;
  /** Who signed as publisher, or null. */
  publisher: string | null;
  /** When the latest step was made. */
  created: string;
}

/** One logged workflow step of a feature. */
export interface WorkflowLogEntry {
  /** Id of the log entry. */
  id: number;
  /** Schema of the feature's table. */
  schema: string;
  /** The feature's table. */
  table: string;
  /** The feature's primary key value. With `schema` and `table` it addresses the item for patchWorkflowItem. */
  gid: number;
  /** The feature's version id (gc2_version_gid), the same across all versions of the feature. */
  version_gid: number;
  /** The status this step gave the feature: 1 drafted, 2 reviewed, 3 published. */
  status: 1 | 2 | 3;
  status_name: 'drafted' | 'reviewed' | 'published';
  /** What the step was. */
  operation: 'insert' | 'update' | 'delete';
  /** Who made the step. */
  user: string;
  /** Who had signed as author after this step, or null. */
  author: string | null;
  /** Who had signed as reviewer after this step, or null. */
  reviewer: string | null;
  /** Who had signed as publisher after this step, or null. */
  publisher: string | null;
  /** When the step was made. */
  created: string;
  /** The workflow roles on the table when the step was made: sub-user => role. */
  roles: Record<string, string>;
}

export interface GetWorkflowLogOptions {
  /** Only entries of tables in this schema. */
  schema?: string;
  /** Number of entries to return, 1-1000. Server default: 100. */
  limit?: number;
  /** Number of entries to skip. Server default: 0. */
  offset?: number;
}

export interface GetWorkflowItemOptions {
  /**
   * List every item of the table instead of only those the caller can still
   * move forward. Only applies when listing (no gid).
   */
  all?: boolean;
}

type Gid = number | string;

function tablePath(schema: string, table: string): string {
  return `api/v4/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}`;
}

function gidPath(gid: Gid | Gid[]): string {
  return (Array.isArray(gid) ? gid : [gid]).map(g => encodeURIComponent(String(g))).join(',');
}

/**
 * Client for the workflow of versioned tables
 * (`/api/v4/schemas/{schema}/tables/{table}/workflow-roles` and `.../workflow-items`,
 * and the log across tables at `/api/v4/workflow-log`).
 *
 * Workflow is switched on per table with `patchTable(schema, table, { versioning: true, workflow: true })`.
 * Edits through the Feature API and WFS-T then create items that move through
 * drafted → reviewed → published. Access to the items is by workflow role, not
 * schema ownership.
 *
 * ```ts
 * const workflow = new Workflow(createCentiaClient({ baseUrl, auth }));
 * await workflow.patchWorkflowRoles('my_schema', 'roads', { subuser: 'joe', role: 'reviewer' });
 * const pending = await workflow.getWorkflowItem('my_schema', 'roads');
 * await workflow.patchWorkflowItem('my_schema', 'roads', pending.map(item => item.gid));
 * ```
 */
export class Workflow {
  constructor(private readonly client: CentiaHttpClient) {}

  /**
   * The sub-users that were given a workflow role on the table. Any
   * authenticated user of the database may read.
   */
  async getWorkflowRoles(schema: string, table: string): Promise<WorkflowRole[]> {
    return this.client.request<WorkflowRole[]>({
      path: `${tablePath(schema, table)}/workflow-roles`,
      method: 'GET',
      contentType: null,
    });
  }

  /**
   * Set the role of one or more sub-users; merges with the existing roles.
   * Database owner only (`403 SUPER_USER_ONLY`).
   */
  async patchWorkflowRoles(
    schema: string,
    table: string,
    roles: WorkflowRole | WorkflowRole[],
  ): Promise<LocationResponse> {
    const res = await this.client.requestFull({
      path: `${tablePath(schema, table)}/workflow-roles`,
      method: 'PATCH',
      body: roles,
      expectedStatus: 303,
    });
    return { location: res.getHeader('Location') ?? '' };
  }

  /**
   * List the items the caller can still move forward, newest first (reviewer:
   * drafted; publisher and owner: drafted and reviewed; author: none).
   * `{ all: true }` lists every item. No role on the table: `403 NO_WORKFLOW_ROLE`.
   */
  async getWorkflowItem(schema: string, table: string, gid?: undefined, opts?: GetWorkflowItemOptions): Promise<WorkflowItem[]>;
  /** Get the item of one feature. Unknown: `404 WORKFLOW_ITEM_NOT_FOUND`. */
  async getWorkflowItem(schema: string, table: string, gid: Gid): Promise<WorkflowItem>;
  /** Get the items of several features. Any unknown: `404 WORKFLOW_ITEM_NOT_FOUND`. */
  async getWorkflowItem(schema: string, table: string, gids: Gid[]): Promise<WorkflowItem[]>;
  async getWorkflowItem(
    schema: string,
    table: string,
    gid?: Gid | Gid[],
    opts?: GetWorkflowItemOptions,
  ): Promise<WorkflowItem | WorkflowItem[]> {
    if (Array.isArray(gid) && gid.length === 0) return [];
    const base = `${tablePath(schema, table)}/workflow-items`;
    const result = await this.client.request<WorkflowItem | WorkflowItem[]>({
      path: gid != null ? `${base}/${gidPath(gid)}` : base,
      method: 'GET',
      query: gid == null && opts?.all ? { all: 'true' } : undefined,
      contentType: null,
    });
    // The API answers a single object for a one-gid list; keep the array contract.
    return Array.isArray(gid) && !Array.isArray(result) ? [result] : result;
  }

  /**
   * The workflow log across tables, newest first: every step logged by an edit
   * or an approval on a workflow table. The database owner gets the whole log;
   * a sub-user the entries of the tables they have a role on (none: an empty
   * array). No total count is returned; page with `limit` and `offset`.
   *
   * To send a feature on from an entry, call patchWorkflowItem with the
   * entry's schema, table and gid.
   */
  async getWorkflowLog(opts: GetWorkflowLogOptions = {}): Promise<WorkflowLogEntry[]> {
    const query: Record<string, string> = {};
    if (opts.schema != null) query.schema = opts.schema;
    if (opts.limit != null) query.limit = String(opts.limit);
    if (opts.offset != null) query.offset = String(opts.offset);
    return this.client.request<WorkflowLogEntry[]>({
      path: 'api/v4/workflow-log',
      method: 'GET',
      query: Object.keys(query).length > 0 ? query : undefined,
      contentType: null,
    });
  }

  /**
   * Approve one or more features: signs with the caller's role and sets that
   * role's status (author 1, reviewer 2, publisher and the database owner 3).
   * A list is all or nothing. `409 WORKFLOW_STATUS_CONFLICT` when a feature is
   * already at or past the caller's status.
   */
  async patchWorkflowItem(schema: string, table: string, gid: Gid | Gid[]): Promise<LocationResponse> {
    if (Array.isArray(gid) && gid.length === 0) {
      throw new Error('patchWorkflowItem needs at least one gid');
    }
    const res = await this.client.requestFull({
      path: `${tablePath(schema, table)}/workflow-items/${gidPath(gid)}`,
      method: 'PATCH',
      contentType: null,
      expectedStatus: 303,
    });
    return { location: res.getHeader('Location') ?? '' };
  }
}
