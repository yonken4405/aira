import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CategoryBadge } from '@aira/ui/web';

describe('CategoryBadge', () => {
  it('renders English as the primary label with the Bisaya word as secondary', () => {
    render(<CategoryBadge category="MEDIKAL" />);
    expect(screen.getByText('Medical')).toBeTruthy();
    expect(screen.getByText('Medikal')).toBeTruthy();
  });

  it('renders every category with a semantic Lucide icon', () => {
    const { container, rerender } = render(<CategoryBadge category="SUNOG" />);
    expect(screen.getByText('Fire')).toBeTruthy();
    expect(screen.getByText('Sunog')).toBeTruthy();
    expect(container.querySelector('svg')).toBeTruthy();

    rerender(<CategoryBadge category="KRIMEN" />);
    expect(screen.getByText('Crime')).toBeTruthy();
    expect(screen.getByText('Krimen')).toBeTruthy();

    rerender(<CategoryBadge category="BAHA" />);
    expect(screen.getByText('Flood')).toBeTruthy();
    expect(screen.getByText('Baha')).toBeTruthy();
  });
});
