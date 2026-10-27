-- 042_department_freepbx_schema.sql
-- Allow code in academic_units to be nullable (when not yet assigned or FreePBX is not configured)
-- Support unified Department / Faculty management with FreePBX integration.

ALTER TABLE academic_units ALTER COLUMN code DROP NOT NULL;
ALTER TABLE academic_units DROP CONSTRAINT IF EXISTS academic_units_code_check;
ALTER TABLE academic_units ADD CONSTRAINT academic_units_code_check CHECK (code IS NULL OR code ~ '^[A-Z0-9_-]{2,20}$');

-- Helper to seed or update units from the management reference
DO $$
DECLARE
  v_admin_id uuid;
  v_operator_id uuid;
  v_bgh_id uuid;
  v_pdt_id uuid;
  v_pctsv_id uuid;
  v_ptckt_id uuid;
  v_tv_id uuid;
  v_pbv_id uuid;
  v_pyt_id uuid;
  v_cntt_id uuid;
  v_qtkd_id uuid;
  v_duoc_id uuid;
  v_nn_id uuid;
  v_luat_id uuid;
BEGIN
  -- 1. Quản trị hệ thống (002, FreePBX, Khối hành chính)
  SELECT id INTO v_admin_id FROM academic_units WHERE name = 'Quản trị hệ thống' OR code = '002';
  IF v_admin_id IS NULL THEN
    v_admin_id := gen_random_uuid();
    INSERT INTO academic_units(id, code, name, kind) VALUES (v_admin_id, '002', 'Quản trị hệ thống', 'office');
  ELSE
    UPDATE academic_units SET code = '002', name = 'Quản trị hệ thống', kind = 'office' WHERE id = v_admin_id;
  END IF;
  INSERT INTO cc_departments(unit_id, extension_from, extension_to, strategy, ring_seconds, max_wait_seconds, wrap_up_seconds, active)
  VALUES (v_admin_id, 200, 299, 'longest_idle', 20, 300, 15, true)
  ON CONFLICT (unit_id) DO UPDATE SET extension_from = 200, extension_to = 299, active = true;

  -- 2. Tổng đài viên (Chưa tạo, Khối hành chính)
  SELECT id INTO v_operator_id FROM academic_units WHERE name = 'Tổng đài viên';
  IF v_operator_id IS NULL THEN
    v_operator_id := gen_random_uuid();
    INSERT INTO academic_units(id, code, name, kind) VALUES (v_operator_id, NULL, 'Tổng đài viên', 'office');
  END IF;

  -- 3. Ban Giám hiệu (Chưa tạo, Khối hành chính)
  SELECT id INTO v_bgh_id FROM academic_units WHERE name = 'Ban Giám hiệu';
  IF v_bgh_id IS NULL THEN
    v_bgh_id := gen_random_uuid();
    INSERT INTO academic_units(id, code, name, kind) VALUES (v_bgh_id, NULL, 'Ban Giám hiệu', 'office');
  END IF;

  -- 4. Phòng Đào tạo (Chưa tạo, Khối hành chính)
  SELECT id INTO v_pdt_id FROM academic_units WHERE name = 'Phòng Đào tạo';
  IF v_pdt_id IS NULL THEN
    v_pdt_id := gen_random_uuid();
    INSERT INTO academic_units(id, code, name, kind) VALUES (v_pdt_id, NULL, 'Phòng Đào tạo', 'office');
  END IF;

  -- 5. Phòng Công tác sinh viên (Chưa tạo, Khối hành chính)
  SELECT id INTO v_pctsv_id FROM academic_units WHERE name = 'Phòng Công tác sinh viên';
  IF v_pctsv_id IS NULL THEN
    v_pctsv_id := gen_random_uuid();
    INSERT INTO academic_units(id, code, name, kind) VALUES (v_pctsv_id, NULL, 'Phòng Công tác sinh viên', 'office');
  END IF;

  -- 6. Phòng Tài chính - Kế toán (Chưa tạo, Khối hành chính)
  SELECT id INTO v_ptckt_id FROM academic_units WHERE name = 'Phòng Tài chính - Kế toán';
  IF v_ptckt_id IS NULL THEN
    v_ptckt_id := gen_random_uuid();
    INSERT INTO academic_units(id, code, name, kind) VALUES (v_ptckt_id, NULL, 'Phòng Tài chính - Kế toán', 'office');
  END IF;

  -- 7. Thư viện (Chưa tạo, Khối hành chính)
  SELECT id INTO v_tv_id FROM academic_units WHERE name = 'Thư viện';
  IF v_tv_id IS NULL THEN
    v_tv_id := gen_random_uuid();
    INSERT INTO academic_units(id, code, name, kind) VALUES (v_tv_id, NULL, 'Thư viện', 'office');
  END IF;

  -- 8. Phòng Bảo vệ (Chưa tạo, Khối hành chính)
  SELECT id INTO v_pbv_id FROM academic_units WHERE name = 'Phòng Bảo vệ';
  IF v_pbv_id IS NULL THEN
    v_pbv_id := gen_random_uuid();
    INSERT INTO academic_units(id, code, name, kind) VALUES (v_pbv_id, NULL, 'Phòng Bảo vệ', 'office');
  END IF;

  -- 9. Phòng Y tế (Chưa tạo, Khối hành chính)
  SELECT id INTO v_pyt_id FROM academic_units WHERE name = 'Phòng Y tế';
  IF v_pyt_id IS NULL THEN
    v_pyt_id := gen_random_uuid();
    INSERT INTO academic_units(id, code, name, kind) VALUES (v_pyt_id, NULL, 'Phòng Y tế', 'office');
  END IF;

  -- 10. Khoa Công nghệ thông tin (001, FreePBX, Khối giảng dạy)
  SELECT id INTO v_cntt_id FROM academic_units WHERE name LIKE '%Công nghệ Thông tin%' OR code = '001' OR code = 'CNTT';
  IF v_cntt_id IS NULL THEN
    v_cntt_id := gen_random_uuid();
    INSERT INTO academic_units(id, code, name, kind) VALUES (v_cntt_id, '001', 'Khoa Công nghệ thông tin', 'faculty');
  ELSE
    UPDATE academic_units SET code = '001', name = 'Khoa Công nghệ thông tin', kind = 'faculty' WHERE id = v_cntt_id;
  END IF;
  INSERT INTO cc_departments(unit_id, extension_from, extension_to, strategy, ring_seconds, max_wait_seconds, wrap_up_seconds, active)
  VALUES (v_cntt_id, 100, 199, 'longest_idle', 20, 300, 15, true)
  ON CONFLICT (unit_id) DO UPDATE SET extension_from = 100, extension_to = 199, active = true;

  -- 11. Khoa Quản trị kinh doanh (003, FreePBX, Khối giảng dạy)
  SELECT id INTO v_qtkd_id FROM academic_units WHERE name = 'Khoa Quản trị kinh doanh' OR code = '003';
  IF v_qtkd_id IS NULL THEN
    v_qtkd_id := gen_random_uuid();
    INSERT INTO academic_units(id, code, name, kind) VALUES (v_qtkd_id, '003', 'Khoa Quản trị kinh doanh', 'faculty');
  ELSE
    UPDATE academic_units SET code = '003', name = 'Khoa Quản trị kinh doanh', kind = 'faculty' WHERE id = v_qtkd_id;
  END IF;
  INSERT INTO cc_departments(unit_id, extension_from, extension_to, strategy, ring_seconds, max_wait_seconds, wrap_up_seconds, active)
  VALUES (v_qtkd_id, 300, 399, 'longest_idle', 20, 300, 15, true)
  ON CONFLICT (unit_id) DO UPDATE SET extension_from = 300, extension_to = 399, active = true;

  -- 12. Khoa Dược (004, FreePBX, Khối giảng dạy)
  SELECT id INTO v_duoc_id FROM academic_units WHERE name = 'Khoa Dược' OR code = '004';
  IF v_duoc_id IS NULL THEN
    v_duoc_id := gen_random_uuid();
    INSERT INTO academic_units(id, code, name, kind) VALUES (v_duoc_id, '004', 'Khoa Dược', 'faculty');
  ELSE
    UPDATE academic_units SET code = '004', name = 'Khoa Dược', kind = 'faculty' WHERE id = v_duoc_id;
  END IF;
  INSERT INTO cc_departments(unit_id, extension_from, extension_to, strategy, ring_seconds, max_wait_seconds, wrap_up_seconds, active)
  VALUES (v_duoc_id, 400, 499, 'longest_idle', 20, 300, 15, true)
  ON CONFLICT (unit_id) DO UPDATE SET extension_from = 400, extension_to = 499, active = true;

  -- 13. Khoa Ngoại ngữ (005, FreePBX, Khối giảng dạy)
  SELECT id INTO v_nn_id FROM academic_units WHERE name = 'Khoa Ngoại ngữ' OR code = '005';
  IF v_nn_id IS NULL THEN
    v_nn_id := gen_random_uuid();
    INSERT INTO academic_units(id, code, name, kind) VALUES (v_nn_id, '005', 'Khoa Ngoại ngữ', 'faculty');
  ELSE
    UPDATE academic_units SET code = '005', name = 'Khoa Ngoại ngữ', kind = 'faculty' WHERE id = v_nn_id;
  END IF;
  INSERT INTO cc_departments(unit_id, extension_from, extension_to, strategy, ring_seconds, max_wait_seconds, wrap_up_seconds, active)
  VALUES (v_nn_id, 500, 599, 'longest_idle', 20, 300, 15, true)
  ON CONFLICT (unit_id) DO UPDATE SET extension_from = 500, extension_to = 599, active = true;

  -- 14. Khoa Luật (Chưa tạo, Khối giảng dạy)
  SELECT id INTO v_luat_id FROM academic_units WHERE name = 'Khoa Luật';
  IF v_luat_id IS NULL THEN
    v_luat_id := gen_random_uuid();
    INSERT INTO academic_units(id, code, name, kind) VALUES (v_luat_id, NULL, 'Khoa Luật', 'faculty');
  END IF;
END $$;
