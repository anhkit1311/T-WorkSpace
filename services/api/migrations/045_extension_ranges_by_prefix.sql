-- Each unit's máy lẻ follow its mã định danh: 1{mã 2 số}{STT 2}, e.g. Khoa CNTT (01) 10101–10199.
-- Extensions created under the old ranges keep their numbers.
UPDATE cc_departments d
SET extension_from = 10000 + u.id_prefix::int * 100 + 1,
    extension_to = 10000 + u.id_prefix::int * 100 + 99
FROM academic_units u
WHERE u.id = d.unit_id AND u.id_prefix IS NOT NULL;
