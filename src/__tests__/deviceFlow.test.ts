import {describe, it, expect, vi, afterEach} from 'vitest'
import {Gc2Service} from '../services/gc2.services'

const token = {access_token: 'a', refresh_token: 'r', token_type: 'bearer', expires_in: 3600}

/** Queue raw responses: [status, body text]. */
function stubFetch(...responses: [number, string][]) {
    const fetchFn = vi.fn()
    for (const [status, text] of responses) {
        fetchFn.mockResolvedValueOnce({
            ok: status >= 200 && status < 300,
            status,
            json: async () => JSON.parse(text),
            text: async () => text,
        } as unknown as Response)
    }
    vi.stubGlobal('fetch', fetchFn)
    return fetchFn
}

function service() {
    return new Gc2Service({host: 'https://api.example.com', clientId: 'my-client', redirectUri: ''})
}

const pending = '{"error":"authorization_pending","error_description":"Waiting"}'

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('Gc2Service.pollToken', () => {
    it('keeps polling on authorization_pending and stops at the first token', async () => {
        const fetchFn = stubFetch([400, pending], [400, pending], [201, JSON.stringify(token)])

        const result = await service().pollToken('abc123', 0)

        expect(result).toEqual(token)
        expect(fetchFn).toHaveBeenCalledTimes(3)
        const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit]
        expect(url).toBe('https://api.example.com/api/v4/oauth')
        expect(JSON.parse(init.body as string)).toEqual({
            client_id: 'my-client',
            device_code: 'abc123',
            grant_type: 'device_code',
        })
    })

    it('keeps polling when the pending answer is pretty-printed JSON', async () => {
        const pretty = JSON.stringify({error: 'authorization_pending', error_description: 'Waiting: not yet'}, null, 2)
        const fetchFn = stubFetch([400, pretty], [201, JSON.stringify(token)])

        expect(await service().pollToken('abc123', 0)).toEqual(token)
        expect(fetchFn).toHaveBeenCalledTimes(2)
    })

    it('throws the error_description, also when it contains ": "', async () => {
        const fetchFn = stubFetch([401, '{"error":"invalid_client","error_description":"Client secret is wrong: expected x"}'])

        await expect(service().pollToken('abc123', 0)).rejects.toThrow('Client secret is wrong: expected x')
        expect(fetchFn).toHaveBeenCalledTimes(1)
    })

    it('throws the error_description from pretty-printed JSON', async () => {
        stubFetch([400, JSON.stringify({error: 'invalid_request', error_description: 'No device matches the code'}, null, 2)])

        await expect(service().pollToken('abc123', 0)).rejects.toThrow(/^No device matches the code$/)
    })

    it('falls back to the error field when there is no description', async () => {
        stubFetch([400, '{"error":"invalid_request"}'])

        await expect(service().pollToken('abc123', 0)).rejects.toThrow(/^invalid_request$/)
    })

    it('gives a readable error with the status code for a non-JSON body', async () => {
        stubFetch([502, '<html><body>Bad Gateway: upstream</body></html>'])

        await expect(service().pollToken('abc123', 0)).rejects.toThrow('Device authorization failed with HTTP 502')
    })

    it('passes network failures through unchanged', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))

        await expect(service().pollToken('abc123', 0)).rejects.toThrow('fetch failed')
    })
})
