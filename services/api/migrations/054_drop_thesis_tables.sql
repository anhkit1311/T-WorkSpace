-- The thesis-management module (022–024, 028) was removed; no code reads these tables any more.
-- academic_audit_events keeps its term_id column (always NULL now); CASCADE only drops its FK.
ALTER TABLE meeting_schedules DROP COLUMN IF EXISTS committee_id;
DROP TABLE IF EXISTS
  thesis_appeals, thesis_results, thesis_reviews, thesis_supervision_logs, thesis_submissions,
  thesis_score_items, thesis_score_sheets, thesis_lecturer_bookings, thesis_defense_slots,
  thesis_grade_ledger, thesis_committee_members, thesis_committees, thesis_rubric_criteria,
  thesis_project_events, thesis_project_transitions, thesis_projects, thesis_registrations,
  thesis_group_members, thesis_groups, thesis_topic_decisions, thesis_topics, thesis_milestones,
  thesis_enrollments, thesis_term_supervisors, thesis_terms
  CASCADE;
DROP FUNCTION IF EXISTS
  thesis_committee_member_guard(), thesis_project_guard_transition(), thesis_result_guard(),
  thesis_review_conflict_guard(), thesis_score_item_guard(), thesis_score_sheet_guard(),
  thesis_slot_bookings(), thesis_submission_guard(), thesis_supervision_log_guard(),
  thesis_term_guard_status();
