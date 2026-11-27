/**
 * @author     Martin Høgh <mh@mapcentia.com>
 * @copyright  2013-2026 MapCentia ApS
 * @license    https://opensource.org/license/mit  The MIT License
 */

import type { CentiaHttpClient } from '../http/client';

/** A built-in MapServer symbol. `name` is the value to put in a style's `symbol`. */
export interface SymbolInfo {
  /** Symbol name: exactly the value a style's `symbol` takes. */
  name: string;
  /**
   * `vector`: `points` is an outline in the symbol's own coordinate space (y grows downwards).
   * `ellipse`: the first point is the x and y radius, so `[[1, 1]]` is a circle.
   */
  type: 'vector' | 'ellipse';
  /** Whether the shape is filled or only stroked. */
  filled: boolean;
  /** The symbol's points as [x, y] pairs, in mapfile order. */
  points: [number, number][];
  /** Anchor point as [x, y] fractions of the symbol's extent. Absent on symbols that define none. */
  anchorpoint?: [number, number];
}

const BASE = 'api/v4/symbols';

/**
 * Client for the built-in MapServer symbols (`/api/v4/symbols`) a style's
 * `symbol` can name, with type and points so a preview can be drawn.
 * Read only; requires a Bearer token (sub-users allowed).
 *
 * A style's `symbol` is not limited to this list; it may also be an image URL
 * or a `[column]` reference.
 *
 * ```ts
 * const symbols = new Symbols(createCentiaClient({ baseUrl, auth }));
 * const all = await symbols.getSymbol();
 * const arrow = await symbols.getSymbol('arrow');
 * ```
 */
export class Symbols {
  constructor(private readonly client: CentiaHttpClient) {}

  /** List all built-in symbols, in the order the mapfile defines them. */
  async getSymbol(): Promise<SymbolInfo[]>;
  /** Get one symbol. Unknown name: `404 SYMBOL_NOT_FOUND`. */
  async getSymbol(name: string): Promise<SymbolInfo>;
  /** Get several symbols, in the order asked. Any unknown name: `404 SYMBOL_NOT_FOUND`. */
  async getSymbol(names: string[]): Promise<SymbolInfo[]>;
  async getSymbol(name?: string | string[]): Promise<SymbolInfo | SymbolInfo[]> {
    if (Array.isArray(name) && name.length === 0) return [];
    const names = name != null ? (Array.isArray(name) ? name : [name]) : null;
    const result = await this.client.request<SymbolInfo | SymbolInfo[]>({
      path: names ? `${BASE}/${names.map(encodeURIComponent).join(',')}` : BASE,
      method: 'GET',
      contentType: null,
    });
    // The API answers a single object for a one-name list; keep the array contract.
    return Array.isArray(name) && !Array.isArray(result) ? [result] : result;
  }
}
