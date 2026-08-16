/**
 * SSE Client Example for MCP HTTP Server
 *
 * Demonstrates how to connect to ACE MCP server with authentication
 */

export class ACEMCPClient {
  private baseUrl: string;
  private token: string;
  private sessionId: string | null = null;
  private eventSource: EventSource | null = null;
  private messageHandlers: Map<string, (data: unknown) => void> = new Map();

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, ''); // Remove trailing slash
    this.token = token;
  }

  /**
   * Create a new session
   */
  async createSession(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/mcp/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
    });

    if (!response.ok) {
      const error = (await response.json()) as { error?: string };
      throw new Error(`Failed to create session: ${error.error || response.statusText}`);
    }

    const data = (await response.json()) as { sessionId: string };
    this.sessionId = data.sessionId;
    return data.sessionId;
  }

  /**
   * Connect to SSE stream
   */
  async connectSSE(): Promise<void> {
    if (!this.sessionId) {
      throw new Error('No session ID. Call createSession() first');
    }

    return new Promise((resolve, reject) => {
      // Note: EventSource doesn't support custom headers in browser
      // For Node.js, you can use `eventsource` package which supports headers
      const url = `${this.baseUrl}/mcp/sse?sessionId=${this.sessionId}`;

      // Browser environment (limited - no Authorization header support)
      if (typeof globalThis !== 'undefined' && (globalThis as Record<string, unknown>).window) {
        this.eventSource = new (
          (globalThis as Record<string, unknown>).window as { EventSource: typeof EventSource }
        ).EventSource(url);
      } else {
        // Node.js environment - requires 'eventsource' package
        try {
          // Dynamic import for Node.js
          const EventSourceModule = require('eventsource');
          this.eventSource = new EventSourceModule(url, {
            headers: {
              Authorization: `Bearer ${this.token}`,
            },
          }) as EventSource;
        } catch (_err) {
          reject(new Error('EventSource not available. Install "eventsource" package for Node.js'));
          return;
        }
      }

      const es = this.eventSource;
      if (!es) {
        reject(new Error('Failed to create EventSource'));
        return;
      }

      es.onopen = () => {
        console.log('[ACE MCP] SSE connection opened');
        resolve();
      };

      es.onerror = (error) => {
        console.error('[ACE MCP] SSE error:', error);
        reject(error);
      };

      // Listen for specific events
      es.addEventListener('connected', (event: MessageEvent) => {
        const data = JSON.parse(event.data);
        console.log('[ACE MCP] Connected:', data);
        this.handleMessage('connected', data);
      });

      es.addEventListener('heartbeat', (event: MessageEvent) => {
        const data = JSON.parse(event.data);
        this.handleMessage('heartbeat', data);
      });

      es.addEventListener('notification', (event: MessageEvent) => {
        const data = JSON.parse(event.data);
        this.handleMessage('notification', data);
      });

      es.addEventListener('close', (event: MessageEvent) => {
        const data = JSON.parse(event.data);
        console.log('[ACE MCP] Server closed connection:', data);
        this.handleMessage('close', data);
        this.disconnect();
      });

      es.addEventListener('reconnect', (event: MessageEvent) => {
        const data = JSON.parse(event.data);
        console.log('[ACE MCP] Reconnect requested:', data);
        this.handleMessage('reconnect', data);
      });
    });
  }

  /**
   * Register event handler
   */
  on(event: string, handler: (data: unknown) => void): void {
    this.messageHandlers.set(event, handler);
  }

  /**
   * Remove event handler
   */
  off(event: string): void {
    this.messageHandlers.delete(event);
  }

  /**
   * Handle incoming SSE message
   */
  private handleMessage(event: string, data: unknown): void {
    const handler = this.messageHandlers.get(event);
    if (handler) {
      handler(data);
    }
  }

  /**
   * Send MCP JSON-RPC request
   */
  async callTool(toolName: string, arguments_: Record<string, unknown>): Promise<unknown> {
    if (!this.sessionId) {
      throw new Error('No session ID. Call createSession() first');
    }

    const payload = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: arguments_,
      },
      id: Date.now(),
    };

    const response = await fetch(`${this.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
        'X-Session-Id': this.sessionId,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = (await response.json()) as { error?: string };
      throw new Error(`MCP request failed: ${error.error || response.statusText}`);
    }

    return response.json();
  }

  /**
   * Search codebase (convenience method)
   */
  async searchCodebase(
    repoPath: string,
    informationRequest: string,
    technicalTerms?: string[],
  ): Promise<unknown> {
    return this.callTool('codebase-retrieval', {
      repo_path: repoPath,
      information_request: informationRequest,
      technical_terms: technicalTerms,
    });
  }

  /**
   * List active sessions
   */
  async listSessions(): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/mcp/sessions`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to list sessions: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get session stats
   */
  async getStats(): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/mcp/stats`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get stats: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Disconnect SSE and destroy session
   */
  async disconnect(): Promise<void> {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.sessionId) {
      try {
        await fetch(`${this.baseUrl}/mcp/session/${this.sessionId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${this.token}`,
          },
        });
      } catch (err) {
        console.error('[ACE MCP] Failed to destroy session:', err);
      }

      this.sessionId = null;
    }
  }
}

/**
 * Example usage (Node.js)
 */
export async function exampleUsage() {
  const client = new ACEMCPClient('http://localhost:3000', 'ace_your_token_here');

  try {
    // Create session
    const sessionId = await client.createSession();
    console.log('Session created:', sessionId);

    // Setup event handlers
    client.on('heartbeat', (data) => {
      console.log('Heartbeat received:', data.timestamp);
    });

    client.on('notification', (data) => {
      console.log('Notification:', data);
    });

    // Connect to SSE stream
    await client.connectSSE();

    // Make MCP request
    const result = await client.searchCodebase('/path/to/repo', 'authentication logic', [
      'login',
      'password',
    ]);
    console.log('Search result:', result);

    // Clean up
    await client.disconnect();
  } catch (err) {
    console.error('Error:', err);
    await client.disconnect();
  }
}
