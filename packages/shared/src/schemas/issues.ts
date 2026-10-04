// ZodError → ValidationIssue[] (API_CONTRACTS §2.2, ADR-023). Shared so server and web agree.
import type { z } from 'zod';
import type { ValidationIssue } from '../types/api';

/** One issue per Zod issue; an `unrecognized_keys` issue becomes one issue per key. */
export function toValidationIssues(error: z.ZodError): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const issue of error.issues) {
    const base = issue.path.map((segment) => String(segment));
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        issues.push({ path: [...base, key].join('.'), message: 'Unrecognized key' });
      }
    } else {
      issues.push({ path: base.join('.'), message: issue.message });
    }
  }
  return issues;
}
