/**
 * @author     Martin Høgh <mh@mapcentia.com>
 * @copyright  2013-2026 MapCentia ApS
 * @license    https://opensource.org/license/mit  The MIT License
 *
 */

import {CodeFlowOptions, GetDeviceCodeResponse, getNonce, GetTokenResponse, GuestFlowOptions, PasswordFlowOptions, SignUpOptions} from '../util/utils';

/** Error for a non-2xx answer from an OAuth endpoint; carries the status and the unparsed body. */
class OAuthHttpError extends Error {
    constructor(readonly status: number, readonly body: string) {
        super(`HTTP error ${status}: ${body}`);
        this.name = 'OAuthHttpError';
    }
}

export class Gc2Service {
    private readonly options: CodeFlowOptions | PasswordFlowOptions | GuestFlowOptions;
    private readonly host: string;

    constructor(options: CodeFlowOptions | PasswordFlowOptions | SignUpOptions | GuestFlowOptions) {
        this.options = options;
        this.host = options.host;
    }

    // Type guards to check if options is CodeFlowOptions or PasswordFlowOptions
    private isCodeFlowOptions(options: CodeFlowOptions | PasswordFlowOptions | SignUpOptions | GuestFlowOptions): options is CodeFlowOptions {
        return 'redirectUri' in options;
    }
    private isPasswordFlowOptions(options: CodeFlowOptions | PasswordFlowOptions | SignUpOptions | GuestFlowOptions): options is PasswordFlowOptions {
        return 'username' in options;
    }
    private isSignUpOptions(options: CodeFlowOptions | PasswordFlowOptions | SignUpOptions | GuestFlowOptions): options is SignUpOptions {
        return 'parentDb' in options;
    }
    private isGuestFlowOptions(options: CodeFlowOptions | PasswordFlowOptions | SignUpOptions | GuestFlowOptions): options is GuestFlowOptions {
        return 'database' in options && !('username' in options);
    }

    private buildUrl(path: string): string {
        if (path.startsWith('http://') || path.startsWith('https://')) {
            return path;
        }
        return `${this.host}${path}`;
    }

    private async request(
        url: string,
        method: 'GET' | 'POST',
        body?: any,
        contentType: 'application/json' | 'application/x-www-form-urlencoded' = 'application/json'
    ): Promise<any> {
        const headers: Record<string, string> = {'Content-Type': contentType};
        let payload: string;

        if (contentType === 'application/json') {
            payload = JSON.stringify(body);
        } else {
            payload = new URLSearchParams(body).toString();
        }

        const response = await fetch(url, {
            method,
            headers,
            body: payload,
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new OAuthHttpError(response.status, errText);
        }

        return response.json();
    }

    async getDeviceCode(): Promise<GetDeviceCodeResponse> {
        const path = this.options.deviceUri ?? `${this.host}/api/v4/oauth/device`;
        return this.request(this.buildUrl(path), 'POST', {
            client_id: this.options.clientId,
        });
    }

    async pollToken(deviceCode: string, interval: number): Promise<GetTokenResponse> {
        const path = this.options.tokenUri ?? `${this.host}/api/v4/oauth`;
        // Returns the token, or null while the user has not approved yet.
        const getToken = async (): Promise<GetTokenResponse | null> => {
            try {
                return await this.request(
                    this.buildUrl(path),
                    'POST',
                    {
                        client_id: this.options.clientId,
                        device_code: deviceCode,
                        grant_type: 'device_code',
                    }
                );
            } catch (e: unknown) {
                // Network failures and the like are not ours to interpret
                if (!(e instanceof OAuthHttpError)) {
                    throw e;
                }
                let err: { error?: unknown; error_description?: unknown } | null = null;
                try {
                    const parsed = JSON.parse(e.body);
                    if (parsed !== null && typeof parsed === 'object') {
                        err = parsed;
                    }
                } catch {
                    // Not JSON, e.g. an HTML page from a proxy
                }
                if (err === null) {
                    throw new Error(`Device authorization failed with HTTP ${e.status}`);
                }
                if (err.error === 'authorization_pending') {
                    return null;
                }
                const reason = [err.error_description, err.error].find(v => typeof v === 'string' && v !== '');
                throw new Error((reason as string | undefined) ?? `Device authorization failed with HTTP ${e.status}`);
            }
        };

        let response = await getToken();
        while (response === null) {
            await new Promise(resolve => setTimeout(resolve, interval * 1100));
            response = await getToken();
        }

        return response;
    }

    getAuthorizationCodeURL(codeChallenge: string, state: string): string {
        let redirectUri: string
        if (this.isCodeFlowOptions(this.options)) {
             redirectUri = this.options.redirectUri
        } else {
            throw new Error('CodeFlow options required for this operation')
        }
        const base = this.options.authUri ?? `${this.host}/auth/`
        const params = new URLSearchParams()
        // Get nonce from local storage if it exists
        const nonce = getNonce()
        // Add parameters conditionally
        params.set('response_type', 'code');
        params.set('client_id', this.options.clientId);
        params.set('redirect_uri', redirectUri);
        params.set('state', state);
        params.set('code_challenge', codeChallenge);
        params.set('code_challenge_method', 'S256');
        if (nonce) {
            params.set('nonce', nonce);
        }
        // Only add scope if it's defined
        if (this.options.scope) {
            params.set('scope', this.options.scope);
        }
        return `${base}?${params.toString()}`;
    }

    getSignUpURL(): string {
        if (!this.isSignUpOptions(this.options)) {
            throw new Error('CodeFlow options required for this operation')
        }
        const base = this.options.authUri ?? `${this.host}/signup/`
        const params = new URLSearchParams()
        params.set('client_id', this.options.clientId)
        params.set('parentdb', this.options.parentDb)
        params.set('redirect_uri', this.options.redirectUri)
        return `${base}?${params.toString()}`;
    }

    async getAuthorizationCodeToken(
        code: string | string[],
        codeVerifier: string | null
    ): Promise<GetTokenResponse> {
        let redirectUri: string
        if (this.isCodeFlowOptions(this.options)) {
            redirectUri = this.options.redirectUri
        } else {
            throw new Error('CodeFlow options required for this operation')
        }
        const path = this.options.tokenUri ?? `${this.host}/api/v4/oauth`;
        return this.request(
            this.buildUrl(path),
            'POST',
            {
                client_id: this.options.clientId,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
                code,
                code_verifier: codeVerifier,
            },
            'application/x-www-form-urlencoded'
        );
    }

    async getPasswordToken(): Promise<GetTokenResponse> {
        let username, password, database
        if (this.isPasswordFlowOptions(this.options)) {
            username = this.options.username
            password = this.options.password
            database = this.options.database
        } else {
            throw new Error('PasswordFlow options required for this operation')
        }
        const path = `${this.host}/api/v4/oauth`;
        return this.request(
            this.buildUrl(path),
            'POST',
            {
                client_id: this.options.clientId,
                client_secret: this.options.clientSecret,
                grant_type: 'password',
                username,
                password,
                database,
            }
        );
    }

    async getGuestToken(): Promise<GetTokenResponse> {
        let database
        if (this.isGuestFlowOptions(this.options)) {
            database = this.options.database
        } else {
            throw new Error('GuestFlow options required for this operation')
        }
        const path = `${this.host}/api/v4/oauth/guest`;
        return this.request(
            this.buildUrl(path),
            'POST',
            {
                database,
                client_id: this.options.clientId,
                client_secret: this.options.clientSecret,
            }
        );
    }

    async getRefreshToken(token: string): Promise<GetTokenResponse> {
        const path = this.options.tokenUri ?? `${this.host}/api/v4/oauth`;
        return this.request(
            this.buildUrl(path),
            'POST',
            {
                client_id: this.options.clientId,
                grant_type: 'refresh_token',
                refresh_token: token,
            }
        );
    }

    getSignOutURL(): string {
        let redirectUri: string
        if (this.isCodeFlowOptions(this.options)) {
            redirectUri = this.options.redirectUri
        } else {
            throw new Error('CodeFlow options required for this operation')
        }
        const params = new URLSearchParams({
            redirect_uri: redirectUri,
        });
        return this.options.logoutUri ?? `${this.host}/signout?${params.toString()}`;
    }
}
