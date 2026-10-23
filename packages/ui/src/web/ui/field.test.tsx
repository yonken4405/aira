import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Field, Input } from './field';

/**
 * Requirement 20.2: THE AIRA_Web SHALL wire the `Field` error message to its
 * associated input via accessible error association so assistive technology
 * announces validation errors.
 *
 * Field must clone its child control to inject `aria-invalid` and
 * `aria-describedby` pointing at the rendered hint/error `<p>` (task 7.2).
 * These tests are written first (task 7.1) and are expected to FAIL until that
 * cloning is implemented.
 */
describe('Field error association (Requirement 20.2)', () => {
  it('marks the child input invalid and describes it by the error message', () => {
    render(
      <Field id="x" label="Label" error="Bad value">
        <Input id="x" />
      </Field>,
    );

    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-invalid', 'true');

    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(describedBy.split(/\s+/)).toContain('x-error');

    // The referenced node must actually exist so the association is valid.
    expect(document.getElementById('x-error')).not.toBeNull();
  });

  it('describes the input by the hint when a hint is present and no error', () => {
    render(
      <Field id="x" label="Label" hint="Helpful hint">
        <Input id="x" />
      </Field>,
    );

    const input = screen.getByRole('textbox');
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(describedBy.split(/\s+/)).toContain('x-hint');

    // No error present, so the input must not be flagged invalid.
    expect(input).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('adds no spurious aria-describedby when there is neither hint nor error', () => {
    render(
      <Field id="x" label="Label">
        <Input id="x" />
      </Field>,
    );

    const input = screen.getByRole('textbox');
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(input).not.toHaveAttribute('aria-invalid', 'true');

    // Existing usage still renders the label and control.
    expect(screen.getByText('Label')).toBeInTheDocument();
    expect(input).toBeInTheDocument();
  });
});
