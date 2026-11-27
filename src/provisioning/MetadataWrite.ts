/**
 * @author     Martin Høgh <mh@mapcentia.com>
 * @copyright  2013-2026 MapCentia ApS
 * @license    https://opensource.org/license/mit  The MIT License
 */

import type { CentiaHttpClient } from '../http/client';
import type {
  GetMetaDataOptions,
  LocationResponse,
  MetaConfigFieldset,
  MetadataResponse,
  PatchMetadataRequest,
} from './types';

/** Path segment for a meta query: parts joined by commas, the `tag:` colon kept readable. */
function queryPath(query: string | string[]): string {
  const parts = Array.isArray(query) ? query : query.split(',');
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => encodeURIComponent(p).replace(/%3A/gi, ':'))
    .join(',');
}

export default class MetadataWrite {
  constructor(private readonly client: CentiaHttpClient) {}

  /**
   * Get relation metadata. `query` is a schema-qualified relation name, a schema name or a
   * tag (`tag:name`); pass an array (or a comma-separated string) to combine several.
   */
  async getMetaData(query: string | string[], opts?: GetMetaDataOptions): Promise<MetadataResponse> {
    return this.requestMeta(`api/v4/meta/${queryPath(query)}`, opts, false);
  }

  /**
   * Get relation metadata of a database without a token: the token-less sibling of
   * getMetaData, with the database in the path. Never sends credentials.
   *
   * `query` is as for getMetaData; leave it out for every relation of the database.
   * Only relations readable without credentials are returned — a protected relation is
   * left out rather than failing the request, so `relations` may be empty.
   */
  async getMetaDataPublic(
    database: string,
    query?: string | string[],
    opts?: GetMetaDataOptions,
  ): Promise<MetadataResponse> {
    const base = `api/v4/meta/database/${encodeURIComponent(database)}`;
    const q = query != null ? queryPath(query) : '';
    return this.requestMeta(q ? `${base}/${q}` : base, opts, true);
  }

  private async requestMeta(
    path: string,
    opts: GetMetaDataOptions | undefined,
    anonymous: boolean,
  ): Promise<MetadataResponse> {
    const res = await this.client.request<MetadataResponse>({
      path,
      method: 'GET',
      query: opts?.noRestriction !== undefined
        ? { noRestriction: String(opts.noRestriction) }
        : undefined,
      ...(anonymous ? { anonymous: true, contentType: null } : {}),
    });
    // The server serialises an empty relation map as `[]`.
    return { ...res, relations: Array.isArray(res.relations) ? {} : res.relations };
  }

  async patchMetaData(body: PatchMetadataRequest): Promise<LocationResponse> {
    const res = await this.client.requestFull({
      path: 'api/v4/meta',
      method: 'PATCH',
      body,
      expectedStatus: 303,
    });
    return { location: res.getHeader('Location') ?? '' };
  }

  /**
   * Get the effective meta config: the fieldsets and fields used to edit the free-form
   * relation `properties`. Built-in fieldsets merged with the server's custom ones (custom wins).
   */
  async getMetaConfig(): Promise<MetaConfigFieldset[]> {
    return this.client.request<MetaConfigFieldset[]>({
      path: 'api/v4/meta-config',
      method: 'GET',
    });
  }
}
