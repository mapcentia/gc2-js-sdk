/**
 * @author     Martin Høgh <mh@mapcentia.com>
 * @copyright  2013-2026 MapCentia ApS
 * @license    https://opensource.org/license/mit  The MIT License
 *
 * Node-only entry point. Importing `@mapcentia/gc2-sdk/node` pulls in the
 * configstore-backed token store, which uses Node-only APIs and must not be
 * bundled for the browser. Browser consumers use the main `@mapcentia/gc2-sdk`
 * entry, which never references this module.
 */

export { createConfigstoreTokenStore } from './auth/configstoreTokenStore'
