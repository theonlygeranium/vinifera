/**
 * Cursor Cloud Agents API Client
 *
 * A lightweight Node.js client for the Cursor Cloud Agents API v1 (public beta).
 * Used by WRITER Agent orchestration scripts to launch and manage Cursor cloud agents.
 *
 * Authentication: Bearer token (Cursor API key from Dashboard → API Keys)
 * Base URL: https://api.cursor.com
 *
 * Usage:
 *   const client = new CursorClient(process.env.CURSOR_API_KEY);
 *   const { agent, run } = await client.createAgent({ prompt: { text: "..." }, repos: [...] });
 *   const result = await client.waitForRun(agent.id, run.id);
 */

class CursorClient {
  constructor(apiKey, baseUrl = "https://api.cursor.com") {
    if (!apiKey) {
      throw new Error("CURSOR_API_KEY is required. Generate one from Cursor Dashboard → API Keys.");
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async _request(method, path, body = null, query = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    const options = {
      method,
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), options);
    const text = await response.text();

    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      const error = new Error(`Cursor API error ${response.status}: ${data?.error || data?.message || text}`);
      error.status = response.status;
      error.code = data?.code;
      error.response = data;
      throw error;
    }

    return data;
  }

  /**
   * Create a Cloud Agent and immediately enqueue its initial run.
   * @param {Object} params - CreateAgentRequest
   * @param {Object} params.prompt - Required. { text: string, images?: array }
   * @param {Object} params.model - Optional. { id: string, params?: array }
   * @param {string} params.name - Optional agent name
   * @param {Object} params.env - Optional environment config
   * @param {Array} params.repos - Optional. [{ url, startingRef, prUrl }]
   * @param {boolean} params.autoCreatePR - Auto-create PR on push (default false)
   * @param {Object} params.envVars - Environment variables for the run
   * @param {Array} params.mcpServers - MCP server configs
   * @returns {Promise<{ agent: Object, run: Object }>}
   */
  async createAgent(params) {
    return this._request("POST", "/v1/agents", params);
  }

  /**
   * List Cloud Agents.
   * @param {Object} query - { limit?, cursor?, prUrl?, includeArchived? }
   * @returns {Promise<{ items: Array, nextCursor: string }>}
   */
  async listAgents(query = {}) {
    return this._request("GET", "/v1/agents", null, query);
  }

  /**
   * Get an Agent by ID.
   * @param {string} agentId - Agent ID (e.g. bc-...)
   * @returns {Promise<Object>}
   */
  async getAgent(agentId) {
    return this._request("GET", `/v1/agents/${agentId}`);
  }

  /**
   * Send a follow-up prompt to an existing agent.
   * Only one run can be active per agent — returns 409 if busy.
   * @param {string} agentId - Agent ID
   * @param {Object} params - { prompt: { text, images? }, mcpServers?, mode? }
   * @returns {Promise<Object>} Run object
   */
  async createRun(agentId, params) {
    return this._request("POST", `/v1/agents/${agentId}/runs`, params);
  }

  /**
   * List runs for an agent.
   * @param {string} agentId
   * @param {Object} query - { limit?, cursor? }
   * @returns {Promise<{ items: Array, nextCursor: string }>}
   */
  async listRuns(agentId, query = {}) {
    return this._request("GET", `/v1/agents/${agentId}/runs`, null, query);
  }

  /**
   * Get a specific run.
   * @param {string} agentId
   * @param {string} runId
   * @returns {Promise<Object>} Run object with status, result, git.branches
   */
  async getRun(agentId, runId) {
    return this._request("GET", `/v1/agents/${agentId}/runs/${runId}`);
  }

  /**
   * Cancel an active run.
   * @param {string} agentId
   * @param {string} runId
   * @returns {Promise<Object>}
   */
  async cancelRun(agentId, runId) {
    return this._request("POST", `/v1/agents/${agentId}/runs/${runId}/cancel`);
  }

  /**
   * Wait for a run to reach a terminal state.
   * Polls the run status until FINISHED, ERROR, CANCELLED, or EXPIRED.
   * @param {string} agentId
   * @param {string} runId
   * @param {Object} options - { pollIntervalMs: 3000, timeoutMs: 600000, onPoll: (run) => void }
   * @returns {Promise<Object>} Final run object
   */
  async waitForRun(agentId, runId, options = {}) {
    const {
      pollIntervalMs = 3000,
      timeoutMs = 600000, // 10 minutes default
      onPoll = null,
    } = options;

    const startTime = Date.now();
    const terminalStates = ["FINISHED", "ERROR", "CANCELLED", "EXPIRED", "finished", "error", "cancelled", "expired"];

    while (true) {
      const run = await this.getRun(agentId, runId);
      const status = (run.status || "").toUpperCase();

      if (onPoll) {
        onPoll(run);
      }

      if (terminalStates.includes(status) || terminalStates.includes(run.status)) {
        return run;
      }

      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Run ${runId} timed out after ${timeoutMs}ms. Last status: ${run.status}`);
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  /**
   * Create an agent and wait for its initial run to complete.
   * Convenience method for the one-agent-per-task pattern.
   * @param {Object} params - Same as createAgent
   * @param {Object} waitOptions - Same as waitForRun options
   * @returns {Promise<{ agent: Object, run: Object }>}
   */
  async createAgentAndWait(params, waitOptions = {}) {
    const { agent, run } = await this.createAgent(params);
    const finalRun = await this.waitForRun(agent.id, run.id, waitOptions);
    return { agent, run: finalRun };
  }

  /**
   * Send a follow-up prompt, handling 409 agent_busy by canceling the active run first.
   * @param {string} agentId
   * @param {Object} params - CreateRunRequest
   * @param {Object} options - { cancelIfBusy: true, waitOptions: {} }
   * @returns {Promise<Object>} Run object
   */
  async sendPrompt(agentId, params, options = {}) {
    const { cancelIfBusy = true, waitOptions = {} } = options;

    try {
      const run = await this.createRun(agentId, params);
      if (waitOptions && Object.keys(waitOptions).length > 0) {
        return await this.waitForRun(agentId, run.id, waitOptions);
      }
      return run;
    } catch (err) {
      if (err.status === 409 && cancelIfBusy) {
        // Agent is busy — find and cancel the active run
        const runs = await this.listRuns(agentId, { limit: 1 });
        const activeRun = runs.items?.[0];
        if (activeRun && ["RUNNING", "CREATING", "running", "creating"].includes(activeRun.status)) {
          await this.cancelRun(agentId, activeRun.id);
        }
        // Retry the prompt
        const run = await this.createRun(agentId, params);
        if (waitOptions && Object.keys(waitOptions).length > 0) {
          return await this.waitForRun(agentId, run.id, waitOptions);
        }
        return run;
      }
      throw err;
    }
  }
}

module.exports = { CursorClient };
