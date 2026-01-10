/**
 * EmptyState Component Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
  it('should render title', () => {
    render(<EmptyState title="No items found" />);
    expect(screen.getByText('No items found')).toBeDefined();
  });

  it('should render description when provided', () => {
    render(
      <EmptyState 
        title="No items" 
        description="Create your first item to get started" 
      />
    );
    expect(screen.getByText('Create your first item to get started')).toBeDefined();
  });

  it('should not render description when not provided', () => {
    const { container } = render(<EmptyState title="No items" />);
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs.length).toBe(0);
  });

  it('should render action button when provided with onClick', () => {
    const handleClick = vi.fn();
    render(
      <EmptyState 
        title="No items" 
        action={{ label: 'Create Item', onClick: handleClick }}
      />
    );
    
    const button = screen.getByText('Create Item');
    expect(button).toBeDefined();
    
    fireEvent.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('should render action link when provided with href', () => {
    const { container } = render(
      <EmptyState 
        title="No items" 
        action={{ label: 'View All', href: '/items' }}
      />
    );
    
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/items');
    expect(screen.getByText('View All')).toBeDefined();
  });

  it('should render icon when provided', () => {
    const { container } = render(
      <EmptyState 
        title="No items" 
        icon="i-lucide-inbox"
      />
    );
    
    const iconSpan = container.querySelector('.i-lucide-inbox');
    expect(iconSpan).toBeDefined();
  });

  it('should not render icon container when icon not provided', () => {
    const { container } = render(<EmptyState title="No items" />);
    const iconContainer = container.querySelector('.w-16');
    expect(iconContainer).toBeNull();
  });

  it('should apply correct styling classes', () => {
    const { container } = render(<EmptyState title="Test" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('text-center');
    expect(wrapper.className).toContain('py-12');
  });
});
