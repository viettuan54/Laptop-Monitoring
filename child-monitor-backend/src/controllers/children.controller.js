exports.getChildren = async (req, res) => {
  let { limit, offset } = req.query;

  // Luôn áp dụng giới hạn bản ghi để tránh quá tải
  // Luôn trả về mảng thuần (không bọc trong object) để giữ contract API cũ
  limit = Math.min(parseInt(limit) || 50, 200);
  offset = Math.max(parseInt(offset) || 0, 0);

  try {
    // Nhờ RLS, truy vấn này sẽ tự động chỉ trả về các con của user hiện tại
    // Không SELECT name_encrypted (cột đã bị xóa khỏi schema qua migration.sql)
    const queryText = 'SELECT child_id, name, age, created_at FROM children ORDER BY created_at DESC LIMIT $1 OFFSET $2';
    const queryParams = [limit, offset];

    const result = await req.db.query(queryText, queryParams);
    res.json(result.rows);
  } catch (error) {
    console.error('Get children error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.createChild = async (req, res) => {
  const { name, age } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ message: 'Name is required and must be a non-empty string' });
  }

  if (name.length > 100) {
    return res.status(400).json({ message: 'Name cannot exceed 100 characters' });
  }

  // Validate age: phải là số nguyên từ 0 đến 18
  if (age !== undefined && age !== null) {
    const ageNum = Number(age);
    if (!Number.isInteger(ageNum) || ageNum < 0 || ageNum > 18) {
      return res.status(400).json({ message: 'age must be an integer between 0 and 18' });
    }
  }

  try {
    // Thêm mới trẻ em gắn liền với user_id của phụ huynh hiện tại
    // Hold the owner row until the RLS transaction completes. A concurrent
    // promotion must either see this child or finish before this role check.
    const owner = await req.db.query(
      'SELECT role FROM users WHERE user_id = $1 FOR SHARE',
      [req.user.user_id]
    );
    if (owner.rows[0]?.role !== 'parent') {
      return res.status(403).json({ message: 'Only parent accounts can own child profiles' });
    }
    const result = await req.db.query(
      'INSERT INTO children(user_id, name, age) VALUES($1, $2, $3) RETURNING child_id, name, age, created_at',
      [req.user.user_id, name.trim(), age !== undefined ? Number(age) : null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create child error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateChild = async (req, res) => {
  const { id } = req.params;
  const { name, age } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ message: 'Name is required and must be a non-empty string' });
  }

  if (name.length > 100) {
    return res.status(400).json({ message: 'Name cannot exceed 100 characters' });
  }

  // Validate age: phải là số nguyên từ 0 đến 18
  if (age !== undefined && age !== null) {
    const ageNum = Number(age);
    if (!Number.isInteger(ageNum) || ageNum < 0 || ageNum > 18) {
      return res.status(400).json({ message: 'age must be an integer between 0 and 18' });
    }
  }

  try {
    // Nhờ RLS, nếu phụ huynh không sở hữu child_id này, câu lệnh UPDATE sẽ không tìm thấy dòng nào để cập nhật
    const result = await req.db.query(
      'UPDATE children SET name = $1, age = $2 WHERE child_id = $3 RETURNING child_id, name, age, created_at',
      [name.trim(), age !== undefined ? Number(age) : null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Child not found or access denied' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update child error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deleteChild = async (req, res) => {
  const { id } = req.params;

  try {
    // Nhờ RLS, nếu phụ huynh không sở hữu child_id này, câu lệnh DELETE sẽ không xóa được dòng nào
    const result = await req.db.query(
      'DELETE FROM children WHERE child_id = $1 RETURNING child_id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Child not found or access denied' });
    }

    res.json({ message: 'Child deleted successfully', child_id: result.rows[0].child_id });
  } catch (error) {
    console.error('Delete child error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
