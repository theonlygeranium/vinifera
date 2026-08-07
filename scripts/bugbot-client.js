/**
 * Bugbot API Client
 * 
 * A lightweight client for the Cursor Bugbot API.
 * Used by WRITER Agent to trigger automated code reviews and retrieve analytics.
 * 
 * Authentication: Basic Auth (API key with admin:* scope)
 * Endpoint: POST https://api.cursor.com/bugbot/review
 * Rate limit: 30 requests/minute (10/min for dryRun)
 * 
 * Note: The Bugbot API requires an Enterprise plan API key with admin:* scope.
 */

class BugbotClient {
  constructor(apiKey, baseUrl = "https://api.cursor.com") {
    if (!apiKey) {
      throw new Error("CURSOR_API_KEY is required for Bugbot. Use an API key with admin:* scope (Enterprise plan).");
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  /**
   * Queue a Bugbot review for a pull request.
   * @param {string} prUrl - Full GitHub PR or GitLab MR URL
   * @param {Object} options - { dryRun: false }
   * @returns {Promise<Object>} { outcome, message, request_id, dry_run }
   */
  async triggerReview(prUrl, options = {}) {
    const { dryRun = false } = options;

    const url = `${this.baseUrl}/bugbot/review`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${Buffer.from(`${this.apiKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prUrl, dryRun }),
    });

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      const error = new Error(`Bugbot API error ${response.status}: ${data?.error || data?.message || text}`);
      error.status = response.status;
      error.response = data;
      throw error;
    }

    return data;
  }

  /**
   * Run a dry-run review (analysis without posting comments to the SCM).
   * Findings are persisted and can be retrieved via the analytics endpoint.
   * Rate limited to 10 requests/minute.
   * @param {string} prUrl - Full GitHub PR or GitLab MR URL
   * @returns {Promise<Object>} { outcome, message, request_id, dry_run: true }
   */
  async dryRunReview(prUrl) {
    return this.triggerReview(prUrl, { dryRun: true });
  }
}

module.exports = { BugbotClient };
