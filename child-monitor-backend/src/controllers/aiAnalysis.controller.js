exports.getAnalysis = async (req, res) => {
  const { device_id } = req.query;
  let { limit, offset } = req.query;

  // Pagination: default 50, max 200
  limit = Math.min(parseInt(limit) || 50, 200);
  offset = Math.max(parseInt(offset) || 0, 0);

  try {
    let queryText = 'SELECT analysis_id, device_id, behavior_type, risk_level, suggestion, analyzed_at FROM ai_analysis';
    const queryParams = [];

    // Nhờ RLS, phụ huynh chỉ truy vấn được dữ liệu phân tích của con mình
    if (device_id) {
      queryParams.push(device_id);
      queryText += ' WHERE device_id = $1';
    }

    queryText += ' ORDER BY analyzed_at DESC';
    queryParams.push(limit);
    queryText += ` LIMIT $${queryParams.length}`;
    queryParams.push(offset);
    queryText += ` OFFSET $${queryParams.length}`;

    const result = await req.db.query(queryText, queryParams);
    res.json({ data: result.rows, limit, offset, count: result.rows.length });
  } catch (error) {
    console.error('Get AI analysis error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getLatestAnalysis = async (req, res) => {
  const { device_id } = req.params;

  try {
    // Lấy phân tích AI mới nhất của một thiết bị cụ thể
    const result = await req.db.query(
      'SELECT analysis_id, device_id, behavior_type, risk_level, suggestion, analyzed_at FROM ai_analysis WHERE device_id = $1 ORDER BY analyzed_at DESC LIMIT 1',
      [device_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No analysis found for this device or access denied' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get latest AI analysis error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const aiService = require('../services/ai.service');

exports.triggerAnalysis = async (req, res) => {
  const { device_id } = req.params;

  try {
    // Ownership đã được requireOwnedDevice kiểm tra và RLS connection đã được
    // giải phóng trước khi bắt đầu tác vụ mạng có thể kéo dài này.
    const result = await aiService.analyzeDeviceActivity(device_id);
    if (result === null) return res.status(422).json({
      code: 'INSUFFICIENT_ACTIVITY', message: 'Chưa đủ nhật ký hoạt động trong 24 giờ qua để đánh giá rủi ro.'
    });
    res.json({
      message: 'AI analysis completed successfully',
      analysis: result
    });
  } catch (error) {
    if (error.code === 'INVALID_AI_RESULT') return res.status(502).json({ code: error.code, message: error.message });
    console.error('Trigger AI analysis error:', error);
    res.status(500).json({ message: 'Failed to run AI analysis' });
  }
};

exports.getSummaryReport = async (req, res) => {
  const { device_id } = req.params;
  const { period } = req.query; // 'daily' hoặc 'weekly'

  try {
    // Ownership đã được requireOwnedDevice kiểm tra và RLS connection đã được
    // giải phóng trước khi gọi Gemini.
    const reportPeriod = period === 'daily' ? 'daily' : 'weekly'; // mặc định là weekly
    const summary = await aiService.generateSummaryReport(device_id, reportPeriod);

    res.json({
      message: 'Summary report generated successfully',
      device_id,
      period: reportPeriod,
      summary
    });
  } catch (error) {
    console.error('Generate summary report error:', error);
    res.status(500).json({ message: 'Failed to generate summary report' });
  }
};

exports.chat = async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ message: 'messages history is required and must be an array' });
  }

  // Giới hạn lịch sử chat (tối đa 20 tin nhắn)
  if (messages.length > 20) {
    return res.status(400).json({ message: 'Chat history cannot exceed 20 messages' });
  }

  const formattedContents = [];
  for (const msg of messages) {
    if (!msg.role || !msg.content) {
      return res.status(400).json({ message: 'Each message must have a role and content' });
    }
    if (msg.role !== 'user' && msg.role !== 'model') {
      return res.status(400).json({ message: "role must be either 'user' or 'model'" });
    }
    // Giới hạn độ dài nội dung tin nhắn (tối đa 2000 ký tự)
    if (typeof msg.content !== 'string' || msg.content.length > 2000) {
      return res.status(400).json({ message: 'Message content length cannot exceed 2000 characters' });
    }
    formattedContents.push({
      role: msg.role,
      parts: [{ text: msg.content }]
    });
  }

  try {
    const reply = await aiService.chatAdvisor(formattedContents);
    res.json({ reply });
  } catch (error) {
    console.error('AI Chatbot error:', error);
    res.status(500).json({ message: 'Failed to process chat with AI' });
  }
};

