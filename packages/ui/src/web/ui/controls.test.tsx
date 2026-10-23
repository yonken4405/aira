import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// These imports intentionally point at a module that does not exist yet
// (task 6.2 implements `controls.tsx`). The failing import is the red state
// for task 6.1 — the tests below pin the accessible contract the
// implementation must satisfy, per Requirement 20 (20.1, 20.3, 20.6).
import { Checkbox, Radio, Switch, Textarea } from './controls';

/**
 * The shared `CONTROL` class in `field.tsx` establishes the visible focus-ring
 * convention every primitive must reuse (R20.3). We assert the hallmark token
 * `focus-visible:outline-fg` is present on each interactive control.
 */
const FOCUS_RING = 'focus-visible:outline-fg';

describe('Textarea (R20.1, R20.3)', () => {
  it('renders a textarea element', () => {
    render(<Textarea aria-label="Notes" />);
    expect(screen.getByRole('textbox', { name: 'Notes' })).toBeInTheDocument();
  });

  it('applies the shared visible focus-ring class', () => {
    render(<Textarea aria-label="Notes" />);
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveClass(FOCUS_RING);
  });

  it('is keyboard operable (accepts typed input)', () => {
    render(<Textarea aria-label="Notes" />);
    const textarea = screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement;
    textarea.focus();
    expect(textarea).toHaveFocus();
    fireEvent.change(textarea, { target: { value: 'hello' } });
    expect(textarea).toHaveValue('hello');
  });

  it('forwards native props and is not inherently disabled', () => {
    render(<Textarea aria-label="Notes" disabled />);
    expect(screen.getByRole('textbox', { name: 'Notes' })).toBeDisabled();
  });
});

describe('Checkbox (R20.1, R20.3, R20.6)', () => {
  it('renders a checkbox input', () => {
    render(<Checkbox aria-label="Email alerts" />);
    expect(screen.getByRole('checkbox', { name: 'Email alerts' })).toBeInTheDocument();
  });

  it('renders the passed label and associates it with the input', () => {
    render(<Checkbox label="Email alerts" />);
    // Label text is the user-facing copy supplied by the caller (R20.6);
    // the control must be reachable by that accessible name.
    const checkbox = screen.getByRole('checkbox', { name: 'Email alerts' });
    expect(checkbox).toBeInTheDocument();
    expect(screen.getByText('Email alerts')).toBeInTheDocument();
  });

  it('applies the shared visible focus-ring class', () => {
    render(<Checkbox aria-label="Email alerts" />);
    expect(screen.getByRole('checkbox', { name: 'Email alerts' })).toHaveClass(FOCUS_RING);
  });

  it('is keyboard/click operable and toggles checked state', () => {
    render(<Checkbox label="Email alerts" />);
    const checkbox = screen.getByRole('checkbox', { name: 'Email alerts' }) as HTMLInputElement;
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
  });
});

describe('Radio (R20.1, R20.3, R20.6)', () => {
  it('renders a radio input', () => {
    render(<Radio name="channel" value="email" label="Email" />);
    expect(screen.getByRole('radio', { name: 'Email' })).toBeInTheDocument();
  });

  it('renders the required label and associates it with the input', () => {
    render(<Radio name="channel" value="email" label="Email" />);
    const radio = screen.getByRole('radio', { name: 'Email' });
    expect(radio).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('applies the shared visible focus-ring class', () => {
    render(<Radio name="channel" value="email" label="Email" />);
    expect(screen.getByRole('radio', { name: 'Email' })).toHaveClass(FOCUS_RING);
  });

  it('is operable and selects on click', () => {
    render(
      <>
        <Radio name="channel" value="email" label="Email" />
        <Radio name="channel" value="sms" label="SMS" />
      </>,
    );
    const email = screen.getByRole('radio', { name: 'Email' }) as HTMLInputElement;
    const sms = screen.getByRole('radio', { name: 'SMS' }) as HTMLInputElement;
    fireEvent.click(email);
    expect(email).toBeChecked();
    fireEvent.click(sms);
    expect(sms).toBeChecked();
    expect(email).not.toBeChecked();
  });
});

describe('Switch (R20.1, R20.3)', () => {
  it('exposes role="switch" with aria-checked reflecting the checked prop', () => {
    const { rerender } = render(
      <Switch checked={false} onCheckedChange={() => {}} label="Web push" />,
    );
    const toggle = screen.getByRole('switch', { name: 'Web push' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    rerender(<Switch checked onCheckedChange={() => {}} label="Web push" />);
    expect(screen.getByRole('switch', { name: 'Web push' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('applies the shared visible focus-ring class', () => {
    render(<Switch checked={false} onCheckedChange={() => {}} label="Web push" />);
    expect(screen.getByRole('switch', { name: 'Web push' })).toHaveClass(FOCUS_RING);
  });

  it('toggles on click via onCheckedChange', () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} label="Web push" />);
    fireEvent.click(screen.getByRole('switch', { name: 'Web push' }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('toggles via keyboard (Space / Enter)', () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} label="Web push" />);
    const toggle = screen.getByRole('switch', { name: 'Web push' });
    toggle.focus();
    expect(toggle).toHaveFocus();

    fireEvent.keyDown(toggle, { key: ' ', code: 'Space' });
    fireEvent.keyDown(toggle, { key: 'Enter', code: 'Enter' });
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('does not fire onCheckedChange when disabled', () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} label="Web push" disabled />);
    fireEvent.click(screen.getByRole('switch', { name: 'Web push' }));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
