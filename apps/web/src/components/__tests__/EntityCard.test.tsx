/**
 * EntityCard Component Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { EntityCard, EntityCardSkeleton } from '../EntityCard';
import type { BundleEntity } from '@1cc/shared';

describe('EntityCard', () => {
  const mockEntity: BundleEntity = {
    id: 'ent1234',
    slug: 'test-entity',
    status: 'published',
    visibility: 'public',
    data: {
      name: 'Test Entity',
      description: 'A test entity description'
    },
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-20T15:30:00Z',
    version: 1
  };

  describe('Rendering', () => {
    it('should render entity name', () => {
      render(<EntityCard entity={mockEntity} typeSlug="articles" />);
      expect(screen.getByText('Test Entity')).toBeDefined();
    });

    it('should render entity description', () => {
      render(<EntityCard entity={mockEntity} typeSlug="articles" />);
      expect(screen.getByText('A test entity description')).toBeDefined();
    });

    it('should render formatted date', () => {
      render(<EntityCard entity={mockEntity} typeSlug="articles" />);
      // Should show Jan 20, 2024 (updatedAt)
      expect(screen.getByText(/Jan 20, 2024/)).toBeDefined();
    });

    it('should render correct link', () => {
      const { container } = render(<EntityCard entity={mockEntity} typeSlug="articles" />);
      const link = container.querySelector('a');
      expect(link?.getAttribute('href')).toBe('/browse/articles/test-entity');
    });

    it('should render fallback name when name is missing', () => {
      const entityWithoutName = {
        ...mockEntity,
        data: { description: 'No name here' }
      };
      render(<EntityCard entity={entityWithoutName} typeSlug="articles" />);
      expect(screen.getByText('Entity ent1234')).toBeDefined();
    });

    it('should not render description when missing', () => {
      const entityWithoutDesc = {
        ...mockEntity,
        data: { name: 'Just Name' }
      };
      const { container } = render(<EntityCard entity={entityWithoutDesc} typeSlug="articles" />);
      const paragraphs = container.querySelectorAll('p');
      expect(paragraphs.length).toBe(0);
    });
  });

  describe('Status badge', () => {
    it('should not show status badge by default', () => {
      render(<EntityCard entity={mockEntity} typeSlug="articles" />);
      expect(screen.queryByText('published')).toBeNull();
    });

    it('should show status badge when showStatus is true', () => {
      render(<EntityCard entity={mockEntity} typeSlug="articles" showStatus={true} />);
      expect(screen.getByText('published')).toBeDefined();
    });

    it('should show draft status', () => {
      const draftEntity = { ...mockEntity, status: 'draft' as const };
      render(<EntityCard entity={draftEntity} typeSlug="articles" showStatus={true} />);
      expect(screen.getByText('draft')).toBeDefined();
    });

    it('should show pending status', () => {
      const pendingEntity = { ...mockEntity, status: 'pending' as const };
      render(<EntityCard entity={pendingEntity} typeSlug="articles" showStatus={true} />);
      expect(screen.getByText('pending')).toBeDefined();
    });
  });

  describe('Styling', () => {
    it('should have card-hover class', () => {
      const { container } = render(<EntityCard entity={mockEntity} typeSlug="articles" />);
      const link = container.querySelector('a');
      expect(link?.className).toContain('card-hover');
    });

    it('should have group class for hover effects', () => {
      const { container } = render(<EntityCard entity={mockEntity} typeSlug="articles" />);
      const link = container.querySelector('a');
      expect(link?.className).toContain('group');
    });
  });
});

describe('EntityCardSkeleton', () => {
  it('should render skeleton elements', () => {
    const { container } = render(<EntityCardSkeleton />);
    const skeletons = container.querySelectorAll('.skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('should have card class', () => {
    const { container } = render(<EntityCardSkeleton />);
    const card = container.querySelector('.card');
    expect(card).toBeDefined();
  });
});
