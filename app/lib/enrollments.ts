/** A learner on the roster who no longer has an Enrollment. */
export function isLapsed(learner: { enrollmentId: number | null }): boolean {
  return learner.enrollmentId === null;
}
