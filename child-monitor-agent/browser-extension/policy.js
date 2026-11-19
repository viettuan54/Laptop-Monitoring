/* Shared by the worker and regression tests; no browser globals here. */
(function (root) {
  function validatePolicy(value) {
    if (!value || value.version !== 1 || typeof value.revision !== 'string'
        || !Array.isArray(value.blocked_domains)) throw new Error('Invalid policy');
    const domains = [...new Set(value.blocked_domains)];
    if (domains.length > 20000 || domains.some(d => typeof d !== 'string' || d.length > 253
        || !/^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/.test(d) || !d.includes('.')
        || d.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))) {
      throw new Error('Invalid domains');
    }
    return {version: 1, revision: value.revision, blocked_domains: domains.sort()};
  }
  function blockedHost(url, domains) {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return null;
      const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
      return domains.some(d => host === d || host.endsWith('.' + d)) ? host : null;
    } catch { return null; }
  }
  function rulesFor(domains) {
    if (!domains.length) return [];
    // Block requests to the domain, and requests originating from its page
    // while open tabs are being moved away (including third-party resources).
    return [
      {id: 1, priority: 1, action: {type: 'block'}, condition: {
        requestDomains: domains,
        resourceTypes: ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image',
          'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other'],
      }},
      {id: 2, priority: 1, action: {type: 'block'}, condition: {initiatorDomains: domains}},
    ];
  }
  class PolicyController {
    constructor(api) { this.api = api; this.domains = []; this.revision = null; }
    async apply(raw) {
      const policy = validatePolicy(raw);
      if (this.revision !== policy.revision) {
        const oldRules = await this.api.declarativeNetRequest.getDynamicRules();
        await this.api.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: oldRules.map(rule => rule.id), addRules: rulesFor(policy.blocked_domains),
        });
        // Persist only after the browser has accepted the rules. Retain the
        // previous policy if the native host disconnects or an update fails.
        await this.api.storage.local.set({webPolicy: policy});
        this.domains = policy.blocked_domains;
        this.revision = policy.revision;
      }
      for (const tab of await this.api.tabs.query({})) await this.enforceTab(tab.id);
    }
    async enforceTab(id) {
      try {
        // Re-read the current URL; never navigate a tab using an old snapshot.
        const tab = await this.api.tabs.get(id);
        const host = blockedHost(tab.pendingUrl || tab.url, this.domains);
        if (host) await this.api.tabs.update(id, {
          url: this.api.runtime.getURL('blocked.html') + '#host=' + encodeURIComponent(host),
        });
      } catch { /* The tab may have closed or changed ownership. */ }
    }
  }
  const exports = {validatePolicy, blockedHost, rulesFor, PolicyController};
  if (typeof module !== 'undefined') module.exports = exports;
  else root.SafeNestPolicy = exports;
})(globalThis);
