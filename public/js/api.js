// Taskora API Client

class ApiClient {
    constructor(baseUrl = '/api') {
        this.baseUrl = baseUrl;
    }

    async request(endpoint, options = {}) {
        const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
        
        const defaultHeaders = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };

        const config = {
            ...options,
            headers: {
                ...defaultHeaders,
                ...(options.headers || {})
            },
            credentials: 'include' // include cookies for JWT auth
        };

        if (options.body && typeof options.body === 'object') {
            config.body = JSON.stringify(options.body);
        }

        try {
            const response = await fetch(url, config);
            const data = await response.json().catch(() => ({
                success: false,
                error: 'Invalid response from server'
            }));

            if (!response.ok) {
                // If 401 Unauthorized and not already on auth/landing page, we can signal auth state
                if (response.status === 401 && window.auth && window.auth.currentUser) {
                    window.auth.handleUnauthorized();
                }
                const error = new Error(data.error || `Request failed with status ${response.status}`);
                error.status = response.status;
                error.data = data;
                throw error;
            }

            return data;
        } catch (err) {
            console.error(`API Error [${options.method || 'GET'} ${endpoint}]:`, err);
            throw err;
        }
    }

    get(endpoint, headers = {}) {
        return this.request(endpoint, { method: 'GET', headers });
    }

    post(endpoint, body, headers = {}) {
        return this.request(endpoint, { method: 'POST', body, headers });
    }

    put(endpoint, body, headers = {}) {
        return this.request(endpoint, { method: 'PUT', body, headers });
    }

    delete(endpoint, headers = {}) {
        return this.request(endpoint, { method: 'DELETE', headers });
    }
}

window.api = new ApiClient();
