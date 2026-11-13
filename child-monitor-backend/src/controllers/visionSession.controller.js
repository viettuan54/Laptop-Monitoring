const { adminPool } = require('../config/db');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

exports.report = async (req, res) => {
  const { session_id, status } = req.body;
  if (!UUID.test(session_id || '') || !['received', 'alert', 'timeout', 'stopped'].includes(status)) {
    return res.status(400).json({ message: 'Invalid vision session report' });
  }
  try {
    // Never let a delayed receipt replace the state of a newer parent request,
    // or let a retried "received" reopen a completed session.
    await adminPool.query(`UPDATE devices d SET vision_session_id = $1,
        vision_session_status = $2, vision_session_reported_at = NOW()
      FROM settings s WHERE d.device_id = $3 AND d.child_id = $4 AND s.child_id = d.child_id
        AND s.vision_session_id = $1
        AND (d.vision_session_id IS DISTINCT FROM $1 OR d.vision_session_status = 'received'
             OR d.vision_session_status IS NULL)`,
    [session_id, status, req.device.device_id, req.device.child_id]);
    res.json({ accepted: true });
  } catch (error) {
    console.error('Vision session report failed:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
