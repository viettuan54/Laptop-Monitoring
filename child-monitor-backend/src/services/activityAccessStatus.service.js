const { domainToASCII } = require('node:url');


const ACCESS_STATUS = Object.freeze({
  BLOCKED: 'blocked',
  OPEN: 'open',
});


function normalizeActivityDomain(value) {
  if (typeof value !== 'string') return null;
  let candidate = value.trim().toLowerCase();
  if (!candidate) return null;
  if (candidate.endsWith('.')) candidate = candidate.slice(0, -1);
  if (candidate.startsWith('www.')) candidate = candidate.slice(4);
  return domainToASCII(candidate) || null;
}


function domainFromActivity(row) {
  const direct = normalizeActivityDomain(row?.domain);
  if (direct) return direct;
  try {
    return normalizeActivityDomain(new URL(row?.url).hostname);
  } catch (_error) {
    return null;
  }
}


function buildDevicePolicyMap(rows) {
  const policies = new Map();
  for (const row of rows || []) {
    const deviceId = String(row.device_id);
    if (!policies.has(deviceId)) {
      policies.set(deviceId, {
        enableAppClassification: row.enable_app_classification === true,
        enableWebClassification: row.enable_web_classification === true,
        blockedAppCategories: new Set(),
        blockedWebCategories: new Set(),
      });
    }
    const policy = policies.get(deviceId);
    if (row.resource_type === 'app' && typeof row.category === 'string') {
      policy.blockedAppCategories.add(row.category);
    }
    if (row.resource_type === 'web' && typeof row.category === 'string') {
      policy.blockedWebCategories.add(row.category);
    }
  }
  return policies;
}


function resolveAccessStatus(row, resourceType, devicePolicies, blockedDomains = new Set()) {
  const policy = devicePolicies.get(String(row.device_id));
  const category = typeof row.category === 'string' ? row.category : 'unknown';

  if (resourceType === 'web') {
    const domain = domainFromActivity(row);
    if (domain && blockedDomains.has(domain)) return ACCESS_STATUS.BLOCKED;
    if (
      policy?.enableWebClassification
      && policy.blockedWebCategories.has(category)
    ) {
      return ACCESS_STATUS.BLOCKED;
    }
    return ACCESS_STATUS.OPEN;
  }

  if (
    resourceType === 'app'
    && policy?.enableAppClassification
    && policy.blockedAppCategories.has(category)
  ) {
    return ACCESS_STATUS.BLOCKED;
  }
  return ACCESS_STATUS.OPEN;
}


async function appendAccessStatuses(db, activityRows, resourceType) {
  if (!['app', 'web'].includes(resourceType)) {
    throw new TypeError('resourceType must be app or web');
  }
  if (!Array.isArray(activityRows) || activityRows.length === 0) return [];

  const deviceIds = [...new Set(
    activityRows
      .map((row) => Number(row.device_id))
      .filter((deviceId) => Number.isInteger(deviceId) && deviceId > 0)
  )];
  if (!deviceIds.length) {
    return activityRows.map((row) => ({ ...row, access_status: ACCESS_STATUS.OPEN }));
  }

  const policyResult = await db.query(
    `SELECT d.device_id,
            COALESCE(s.enable_app_classification, FALSE) AS enable_app_classification,
            COALESCE(s.enable_web_classification, FALSE) AS enable_web_classification,
            policy.resource_type::text AS resource_type,
            policy.category
     FROM devices d
     LEFT JOIN settings s ON s.child_id = d.child_id
     LEFT JOIN child_category_policies policy
       ON policy.child_id = d.child_id
      AND policy.action = 'block'
     WHERE d.device_id = ANY($1::int[])`,
    [deviceIds]
  );
  const devicePolicies = buildDevicePolicyMap(policyResult.rows);

  let blockedDomains = new Set();
  if (resourceType === 'web') {
    const blacklistResult = await db.query('SELECT domain FROM website_blacklist');
    blockedDomains = new Set(
      blacklistResult.rows
        .map((row) => normalizeActivityDomain(row.domain))
        .filter(Boolean)
    );
  }

  return activityRows.map((row) => ({
    ...row,
    access_status: resolveAccessStatus(
      row,
      resourceType,
      devicePolicies,
      blockedDomains
    ),
  }));
}


module.exports = {
  ACCESS_STATUS,
  appendAccessStatuses,
  buildDevicePolicyMap,
  domainFromActivity,
  normalizeActivityDomain,
  resolveAccessStatus,
};
