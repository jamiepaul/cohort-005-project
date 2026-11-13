import { describe, expect, it } from "vitest";
import { isLapsed } from "./enrollments";

describe("isLapsed", () => {
  it("is false while the learner still has an Enrollment", () => {
    expect(isLapsed({ enrollmentId: 12 })).toBe(false);
  });

  it("is true once the learner's Enrollment has ended", () => {
    expect(isLapsed({ enrollmentId: null })).toBe(true);
  });
});
