/**
 * StatusBadge Component Tests
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { StatusBadge } from '../StatusBadge';

describe('StatusBadge', () => {
  describe('Rendering', () => {
    it('should render draft status', () => {
      render(<StatusBadge status="draft" />);
      expect(screen.getByText('Draft')).toBeDefined();
    });

    it('should render pending status', () => {
      render(<StatusBadge status="pending" />);
      expect(screen.getByText('Pending')).toBeDefined();
    });

    it('should render published status', () => {
      render(<StatusBadge status="published" />);
      expect(screen.getByText('Published')).toBeDefined();
    });

    it('should render archived status', () => {
      render(<StatusBadge status="archived" />);
      expect(screen.getByText('Archived')).toBeDefined();
    });

    it('should render deleted status', () => {
      render(<StatusBadge status="deleted" />);
      expect(screen.getByText('Deleted')).toBeDefined();
    });
  });

  describe('Styling', () => {
    it('should apply badge-draft class for draft', () => {
      const { container } = render(<StatusBadge status="draft" />);
      const badge = container.querySelector('span');
      expect(badge?.className).toContain('badge-draft');
    });

    it('should apply badge-pending class for pending', () => {
      const { container } = render(<StatusBadge status="pending" />);
      const badge = container.querySelector('span');
      expect(badge?.className).toContain('badge-pending');
    });

    it('should apply badge-published class for published', () => {
      const { container } = render(<StatusBadge status="published" />);
      const badge = container.querySelector('span');
      expect(badge?.className).toContain('badge-published');
    });

    it('should apply badge-archived class for archived', () => {
      const { container } = render(<StatusBadge status="archived" />);
      const badge = container.querySelector('span');
      expect(badge?.className).toContain('badge-archived');
    });

    it('should apply badge-archived class for deleted', () => {
      const { container } = render(<StatusBadge status="deleted" />);
      const badge = container.querySelector('span');
      expect(badge?.className).toContain('badge-archived');
    });
  });

  describe('Edge cases', () => {
    it('should handle unknown status gracefully', () => {
      // @ts-expect-error Testing invalid status
      render(<StatusBadge status="unknown" />);
      // Should fall back to draft styling
      expect(screen.getByText('Draft')).toBeDefined();
    });
  });
});
