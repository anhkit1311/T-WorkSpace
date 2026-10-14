import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalJson,
  chainHash,
  committeeAggregate,
  finalScore,
  GENESIS_HASH,
  letterGrade,
  sheetTotal,
  verifyChain,
} from "../../../dist/api/modules/academic/grading.js";
import { buildSchedule } from "../../../dist/api/modules/academic/scheduler.js";
import {
  estimateJaccard,
  jaccard,
  minhash,
  normalize,
  shingles,
  similarTopics,
} from "../../../dist/api/modules/academic/similarity.js";
import { csvCell, toCsv } from "../../../dist/api/modules/academic/reports.js";

test("rubric totals are weighted means and reject invalid input", () => {
  assert.equal(sheetTotal([{ weight: 40, score: 8 }, { weight: 60, score: 7.5 }]), 7.7);
  assert.equal(sheetTotal([{ weight: 33.33, score: 9 }, { weight: 33.33, score: 9 }, { weight: 33.34, score: 9 }]), 9);
  assert.throws(() => sheetTotal([{ weight: 50, score: 8 }]), /sum to 100/);
  assert.throws(() => sheetTotal([{ weight: 100, score: 8.1 }]), /0.25/);
  assert.throws(() => sheetTotal([{ weight: 100, score: 10.25 }]), /0.25/);
});

test("committee deviation and final score follow term policy", () => {
  const ok = committeeAggregate([8, 8.5, 7.5], 2);
  assert.deepEqual(ok, { mean: 8, spread: 1, deviates: false });
  const wide = committeeAggregate([9, 8.5, 8, 6.5], 2);
  assert.equal(wide.spread, 2.5);
  assert.equal(wide.deviates, true);
  assert.equal(committeeAggregate([7, 9], 2).deviates, false, "a spread equal to the limit is allowed");
  assert.equal(finalScore({ supervisor: 8, reviewer: 7, committee: 8.5 }, { supervisor: 20, reviewer: 20, committee: 60 }), 8.1);
  assert.throws(() => finalScore({ supervisor: 8, reviewer: 7, committee: 8 }, { supervisor: 30, reviewer: 30, committee: 30 }));
});

test("letter grades use the 10-point credit-system bands", () => {
  const cases = [[10, "A"], [8.5, "A"], [8.4, "B+"], [8, "B+"], [7, "B"], [6.9, "C+"], [6.5, "C+"], [5.5, "C"], [5.4, "D+"], [5, "D+"], [4, "D"], [3.9, "F"], [0, "F"]];
  for (const [score, letter] of cases) assert.equal(letterGrade(score), letter, `score ${score}`);
});

test("ledger hash chain detects edits, reordering and broken links", () => {
  const payloads = [{ b: 2, a: 1 }, { finalScore: 8.1 }, { finalScore: 7.4 }].map(canonicalJson);
  assert.equal(payloads[0], '{"a":1,"b":2}', "canonical JSON sorts keys");
  const entries = [];
  let prev = GENESIS_HASH;
  payloads.forEach((payload, index) => {
    const hash = chainHash(prev, payload);
    entries.push({ seq: index + 1, payload, prevHash: prev, hash });
    prev = hash;
  });
  assert.equal(verifyChain(entries), null);
  const edited = entries.map((entry) => ({ ...entry }));
  edited[1].payload = canonicalJson({ finalScore: 9.9 });
  assert.deepEqual(verifyChain(edited), { seq: "2", reason: "hash_mismatch" });
  const rehashed = edited.map((entry) => ({ ...entry }));
  rehashed[1].hash = chainHash(rehashed[1].prevHash, rehashed[1].payload);
  assert.deepEqual(verifyChain(rehashed), { seq: "3", reason: "broken_link" }, "recomputing one hash breaks the next link");
  assert.deepEqual(verifyChain([entries[1], entries[0]]), { seq: "2", reason: "broken_link" });
});

const at = (hour, minute = 0) => new Date(Date.UTC(2026, 11, 15, hour, minute));

test("scheduler respects supervisor exclusion, member availability and committee sequencing", () => {
  const committees = [
    { id: "c1", memberIds: ["L1", "L2", "L3"], sessions: [{ start: at(1), end: at(4) }] },
    { id: "c2", memberIds: ["L4", "L5", "L6"], sessions: [{ start: at(1), end: at(4) }] },
  ];
  const projects = [
    { id: "p1", supervisorIds: ["L1"], reviewerId: "L5" },
    { id: "p2", supervisorIds: ["L4"], reviewerId: "L2" },
    { id: "p3", supervisorIds: ["L7"], reviewerId: "L2" },
    { id: "p4", supervisorIds: ["L7"], reviewerId: null },
    { id: "p5", supervisorIds: ["L1", "L4"], reviewerId: null },
  ];
  const { scheduled, unscheduled } = buildSchedule({ projects, committees, slotMinutes: 60, allowSupervisorInCommittee: false });
  const byId = Object.fromEntries(scheduled.map((item) => [item.projectId, item]));
  assert.equal(byId.p1.committeeId, "c2", "L1 supervises p1, so c1 is excluded");
  assert.equal(byId.p2.committeeId, "c1");
  assert.equal(byId.p3.committeeId, "c1", "reviewer preference places p3 with L2");
  assert.deepEqual(unscheduled, [{ projectId: "p5", reason: "no_eligible_committee" }]);
  // No two defenses of a committee overlap.
  for (const committee of ["c1", "c2"]) {
    const slots = scheduled.filter((s) => s.committeeId === committee).sort((a, b) => a.start - b.start);
    for (let i = 1; i < slots.length; i++) assert.ok(slots[i].start >= slots[i - 1].end);
  }
  // External busy time pushes defenses later.
  const busy = buildSchedule({
    projects: [{ id: "p9", supervisorIds: ["X"], reviewerId: null }],
    committees: [committees[0]],
    slotMinutes: 60,
    allowSupervisorInCommittee: false,
    busy: [{ lecturerId: "L3", start: at(1), end: at(2, 30) }],
  });
  assert.equal(+busy.scheduled[0].start, +at(3));
  const full = buildSchedule({
    projects: ["a", "b", "c", "d"].map((id) => ({ id, supervisorIds: ["X"], reviewerId: null })),
    committees: [committees[0]],
    slotMinutes: 60,
    allowSupervisorInCommittee: false,
  });
  assert.equal(full.scheduled.length, 3);
  assert.deepEqual(full.unscheduled, [{ projectId: "d", reason: "no_free_slot" }]);
  assert.deepEqual(buildSchedule({ projects, committees, slotMinutes: 60, allowSupervisorInCommittee: false }), { scheduled, unscheduled }, "deterministic");
});

test("similarity folds Vietnamese diacritics and ranks near-duplicate titles", () => {
  assert.equal(normalize("Đồ ÁN Tốt-nghiệp: Hệ thống!"), "do an tot nghiep he thong");
  const a = shingles("Xây dựng hệ thống quản lý thư viện trường đại học");
  const b = shingles("Xay dung he thong quan ly thu vien truong dai hoc");
  assert.equal(jaccard(a, b), 1);
  const set1 = shingles("nhan dien khuon mat bang hoc sau cho diem danh sinh vien", 2);
  const set2 = shingles("nhan dien khuon mat bang hoc sau cho kiem soat ra vao", 2);
  const exact = jaccard(set1, set2);
  const estimate = estimateJaccard(minhash(set1, 256), minhash(set2, 256));
  assert.ok(Math.abs(exact - estimate) < 0.15, `MinHash estimate ${estimate} close to ${exact}`);
  const ranked = similarTopics(
    { title: "Ứng dụng học sâu nhận diện khuôn mặt để điểm danh sinh viên", summary: "Hệ thống điểm danh tự động bằng camera trong lớp học sử dụng mạng nơ-ron tích chập" },
    [
      { id: "1", code: "T001", termCode: "K21", title: "Nhận diện khuôn mặt điểm danh sinh viên bằng học sâu", summary: "Điểm danh tự động bằng camera trong lớp học, sử dụng mạng nơ-ron tích chập" },
      { id: "2", code: "T002", termCode: "K21", title: "Website bán hàng thời trang", summary: "Thương mại điện tử cho cửa hàng quần áo nhỏ" },
    ],
    { limit: 5, threshold: 0.1 },
  );
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].code, "T001");
});

test("CSV export quotes fields and neutralises spreadsheet formulas", () => {
  assert.equal(csvCell('a "b", c'), '"a ""b"", c"');
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell(null), "");
  assert.equal(toCsv(["x", "y"], [[1, "Nguyễn Văn A"]]), "x,y\r\n1,Nguyễn Văn A\r\n");
});
