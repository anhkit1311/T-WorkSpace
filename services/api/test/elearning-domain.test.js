import assert from "node:assert/strict";
import { test } from "node:test";
import { draftProblem, drawQuestions, gradeAttempt, isCorrect, isLate, questionProblem, shuffledOptions } from "../../../dist/api/modules/elearning/domain/quiz.js";
import { completionPercent, liveAttendance } from "../../../dist/api/modules/elearning/domain/progress.js";
import { CourseAccess } from "../../../dist/api/modules/elearning/domain/access.js";

const options = [{ id: "a", text: "A" }, { id: "b", text: "B" }, { id: "c", text: "C" }];

test("Question bank accepts the three kinds and rejects malformed answers", () => {
  assert.equal(questionProblem("single", options, ["b"]), null);
  assert.equal(questionProblem("multiple", options, ["a", "c"]), null);
  assert.equal(questionProblem("true_false", [], [false]), null);
  assert.ok(questionProblem("single", options, ["a", "b"]));
  assert.ok(questionProblem("multiple", options, ["z"]));
  assert.ok(questionProblem("single", [{ id: "a", text: "A" }], ["a"]), "needs two options");
  assert.ok(questionProblem("true_false", [], ["true"]), "boolean, not a string");
  assert.ok(questionProblem("single", [{ id: "a", text: "A" }, { id: "a", text: "B" }], ["a"]), "duplicate ids");
});

test("Grading is all-or-nothing per question and weighted by points", () => {
  const questions = [
    { id: "q1", kind: "single", options, answer: ["b"], points: 1 },
    { id: "q2", kind: "multiple", options, answer: ["a", "c"], points: 2 },
    { id: "q3", kind: "true_false", options: [], answer: [true], points: 1 },
  ];
  assert.equal(isCorrect(questions[1], ["c", "a"]), true);
  assert.equal(isCorrect(questions[1], ["a"]), false, "a partial pick scores nothing");
  assert.equal(isCorrect(questions[1], ["a", "a", "c"]), false);
  assert.equal(isCorrect(questions[2], "true"), false);
  const graded = gradeAttempt(questions, { q1: ["b"], q2: ["a", "c"], q3: [false] }, 70);
  assert.deepEqual([graded.score, graded.maxScore, graded.percent, graded.passed], [3, 4, 75, true]);
  assert.equal(gradeAttempt(questions, {}, 50).passed, false);
  const deadline = new Date("2026-10-18T10:00:00Z");
  assert.equal(isLate(deadline, new Date("2026-10-18T10:00:20Z")), false, "within the grace");
  assert.equal(isLate(deadline, new Date("2026-10-18T10:00:31Z")), true);
  assert.equal(isLate(null, new Date()), false, "no time limit");
});

test("Progress and live attendance (>= 70% of the class, overlapping tabs once)", () => {
  assert.equal(completionPercent(0, 0), 0);
  assert.equal(completionPercent(3, 2), 67);
  assert.equal(completionPercent(3, 5), 100);
  const min = 60_000;
  // Class 0..60 min; joined 5..30 and again 28..50 (overlap), plus a connection before class.
  const present = liveAttendance([{ from: -10 * min, to: 0 }, { from: 5 * min, to: 30 * min }, { from: 28 * min, to: 50 * min }], 0, 60 * min);
  assert.equal(present.presentSeconds, 45 * 60);
  assert.equal(present.ratio, 0.75);
  assert.equal(present.attended, true);
  assert.equal(liveAttendance([{ from: 0, to: 41 * min }], 0, 60 * min).attended, false, "68% is not enough");
  assert.equal(liveAttendance([{ from: 0, to: 42 * min }], 0, 60 * min).attended, true, "exactly 70%");
});

test("Course access: staff of the unit create, owner/co-teacher/unit admin manage", () => {
  const course = { id: "c", unitId: "u1", ownerId: "owner", instructorIds: ["co"], status: "draft", enrollment: "open" };
  const lecturer = new CourseAccess("lec", false, new Set(), new Set(["u1"]));
  assert.equal(lecturer.canCreateIn("u1"), true);
  assert.equal(lecturer.canCreateIn("u2"), false);
  assert.equal(lecturer.manages(course), false);
  assert.equal(new CourseAccess("co", false, new Set(), new Set()).manages(course), true);
  assert.equal(new CourseAccess("x", false, new Set(["u1"]), new Set()).manages(course), true);
  const student = new CourseAccess("s", false, new Set(), new Set());
  assert.equal(student.canSee(course, false), false, "drafts are hidden");
  assert.equal(student.canSee({ ...course, status: "published" }, false), true);
  assert.equal(student.canSelfEnroll({ ...course, status: "published", enrollment: "assigned" }), false);
});

test("Quiz draws N questions at random and keeps option order stable per attempt", () => {
  const ids = ["q1", "q2", "q3", "q4"];
  assert.deepEqual(drawQuestions(ids, null, false), ids, "no draw, no shuffle: quiz order");
  const sequence = [0.9, 0.1, 0.5];
  const drawn = drawQuestions(ids, 2, false, () => sequence.shift() ?? 0);
  assert.equal(drawn.length, 2);
  assert.ok(drawn.every((item) => ids.includes(item)) && new Set(drawn).size === 2);
  assert.deepEqual([...drawQuestions(ids, null, true)].sort(), ids, "shuffle keeps every question");
  const first = shuffledOptions(options, "attempt-1").map((option) => option.id);
  assert.deepEqual(shuffledOptions(options, "attempt-1").map((option) => option.id), first, "same attempt, same order");
  assert.deepEqual([...first].sort(), ["a", "b", "c"]);
  assert.equal(draftProblem({ q1: ["a"], q2: [true] }, ["q1", "q2"]), null);
  assert.ok(draftProblem({ q9: ["a"] }, ["q1"]), "foreign question");
  assert.ok(draftProblem({ q1: "a" }, ["q1"]), "not an array");
  assert.ok(draftProblem([], ["q1"]));
});
