/**
 * @author     Martin Høgh <mh@mapcentia.com>
 * @copyright  2013-2026 MapCentia ApS
 * @license    https://opensource.org/license/mit  The MIT License
 */

import type { CentiaHttpClient } from '../http/client';

/** One entry of a layer's legend. */
export interface LegendClass {
  /**
   * Class name. Null for the single picture of a layer whose legend comes from
   * an external source (external WMS, QGIS project or the layer's own legend URL).
   */
  name: string | null;
  /** The class expression, or null when the class has none. */
  expression: string | null;
  /**
   * The icon as a base64 encoded PNG without `data:` prefix — see {@link legendImageUrl}.
   * Null when it could not be drawn.
   */
  img: string | null;
}

/** The legend of one layer. */
export interface Legend {
  /** The layer as schema qualified relation name, e.g. `my_schema.roads`. */
  id: string;
  /** The layer's title, or its table name when it has none. */
  title: string;
  /** The named classes of the layer in drawing order. Empty when the layer has no named classes. */
  classes: LegendClass[];
}

/** Turn a legend class `img` into a `data:` URL usable as an image source; null when there is no image. */
export function legendImageUrl(img: string | null | undefined): string | null {
  return img ? `data:image/png;base64,${img}` : null;
}

/**
 * Client for layer legends (`/api/v4/legends`).
 *
 * The endpoint accepts Bearer token, HTTP Basic and anonymous requests; a
 * Bearer token must match the `database` in the path
 * (`401 TOKEN_DATABASE_MISMATCH` otherwise). An unknown database answers
 * `404 DATABASE_NOT_FOUND`.
 *
 * ```ts
 * const legends = new Legends(createCentiaClient({ baseUrl, auth }));
 * const result = await legends.getLegend('my_database', ['my_schema.roads', 'my_schema.buildings']);
 * ```
 */
export class Legends {
  constructor(private readonly client: CentiaHttpClient) {}

  /**
   * Get the legends of one or more layers, each given as `schema.table`; a bare
   * `schema` stands for all layers of that schema.
   *
   * Always answers an array. A layer the caller may not read, or that does not
   * exist, is left out rather than failing the request, so the result may be empty.
   */
  async getLegend(database: string, layers: string | string[]): Promise<Legend[]> {
    const list = (Array.isArray(layers) ? layers : layers.split(','))
      .map(layer => layer.trim())
      .filter(Boolean);
    if (list.length === 0) return [];
    return this.client.request<Legend[]>({
      path: `api/v4/legends/database/${encodeURIComponent(database)}/${list.map(encodeURIComponent).join(',')}`,
      method: 'GET',
      contentType: null,
    });
  }
}
