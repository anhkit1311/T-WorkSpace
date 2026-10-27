-- Mã định danh 2 số of each faculty (01–49) / office (50–99): the prefix of the mã số issued to its
-- people. Separate from academic_units.code, which the switchboard uses.
ALTER TABLE academic_units ADD COLUMN IF NOT EXISTS id_prefix char(2) CHECK (id_prefix ~ '^[0-9]{2}$');
CREATE UNIQUE INDEX IF NOT EXISTS academic_units_id_prefix_key ON academic_units (id_prefix);

-- The faculty / office an account belongs to now (the mã số keeps the one it was issued under).
ALTER TABLE users ADD COLUMN IF NOT EXISTS unit_id uuid REFERENCES academic_units(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS users_unit_id_idx ON users (unit_id);

-- Existing units get the next free prefix in their range, in code then name order.
WITH numbered AS (
  SELECT id, kind,
         row_number() OVER (PARTITION BY COALESCE(kind, 'faculty') ORDER BY code NULLS LAST, name) AS n
  FROM academic_units WHERE id_prefix IS NULL
)
UPDATE academic_units u
SET id_prefix = lpad(((CASE WHEN numbered.kind = 'office' THEN 49 ELSE 0 END)
  + (SELECT COUNT(*) FROM academic_units x WHERE x.id_prefix IS NOT NULL AND COALESCE(x.kind, 'faculty') = COALESCE(numbered.kind, 'faculty'))
  + numbered.n)::text, 2, '0')
FROM numbered WHERE numbered.id = u.id;

-- Lecturers already belong to a faculty.
UPDATE users u SET unit_id = s.unit_id FROM academic_staff s WHERE s.user_id = u.id AND u.unit_id IS NULL;
