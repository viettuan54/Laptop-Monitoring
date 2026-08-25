const DEFAULT_AGENT_CONFIG = Object.freeze({
  daily_limit_minutes: 120,
  allowed_start_time: '07:00:00',
  allowed_end_time: '21:00:00',
  is_locked: false,
  enable_webcam_monitoring: false,
  enable_screenshot_review: false,
  enable_keylog: false,
  enable_app_classification: false,
  enable_web_classification: false,
  enable_text_moderation: false,
});
const MAX_POLICY_BLOCKED_DOMAINS = 5000;

function groupBlockedCategories(rows) {
  const grouped = { app: [], web: [] };
  for (const row of rows || []) {
    const resourceType = row?.resource_type;
    const category = row?.category;
    if (!Object.hasOwn(grouped, resourceType) || typeof category !== 'string') continue;
    if (!grouped[resourceType].includes(category)) grouped[resourceType].push(category);
  }
  grouped.app.sort();
  grouped.web.sort();
  return grouped;
}

async function getAgentPolicyConfig(db, childId) {
  const [settingsResult, policyResult] = await Promise.all([
    db.query(
      `SELECT daily_limit_minutes, allowed_start_time, allowed_end_time,
              is_locked, enable_webcam_monitoring, enable_screenshot_review, enable_keylog,
              enable_app_classification, enable_web_classification, enable_text_moderation
       FROM settings
       WHERE child_id = $1`,
      [childId]
    ),
    db.query(
      `SELECT resource_type::text AS resource_type, category
       FROM child_category_policies
       WHERE child_id = $1 AND action = 'block'
       ORDER BY resource_type, category`,
      [childId]
    ),
  ]);

  const blocked = groupBlockedCategories(policyResult.rows);
  return {
    ...DEFAULT_AGENT_CONFIG,
    ...(settingsResult.rows[0] || {}),
    blocked_app_categories: blocked.app,
    blocked_web_categories: blocked.web,
  };
}

async function getPolicyBlockedWebDomains(db, childId) {
  const result = await db.query(
    `WITH latest_domain_labels AS (
       SELECT DISTINCT ON (lower(w.domain))
              lower(w.domain) AS domain,
              w.category::text AS category
       FROM website_logs w
       INNER JOIN devices d ON d.device_id = w.device_id
       WHERE d.child_id = $1
         AND w.domain IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM settings s
           WHERE s.child_id = $1 AND s.enable_web_classification = TRUE
         )
       ORDER BY lower(w.domain), (w.category = 'unknown') ASC,
                w.visit_time DESC, w.log_id DESC
     )
     SELECT latest.domain
     FROM latest_domain_labels latest
     INNER JOIN child_category_policies policy
       ON policy.child_id = $1
      AND policy.resource_type = 'web'
      AND policy.category = latest.category
      AND policy.action = 'block'
     ORDER BY latest.domain
     LIMIT $2`,
    [childId, MAX_POLICY_BLOCKED_DOMAINS]
  );
  return result.rows
    .map((row) => row.domain)
    .filter((domain) => typeof domain === 'string');
}

async function getAgentPolicySnapshot(db, childId) {
  const [config, policyBlockedDomains] = await Promise.all([
    getAgentPolicyConfig(db, childId),
    getPolicyBlockedWebDomains(db, childId),
  ]);
  return {
    config,
    policy_blocked_domains: policyBlockedDomains,
  };
}

module.exports = {
  DEFAULT_AGENT_CONFIG,
  MAX_POLICY_BLOCKED_DOMAINS,
  getAgentPolicyConfig,
  getAgentPolicySnapshot,
  getPolicyBlockedWebDomains,
  groupBlockedCategories,
};
