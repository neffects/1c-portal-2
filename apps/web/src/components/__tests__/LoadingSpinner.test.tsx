/**
 * LoadingSpinner Component Tests
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { LoadingSpinner, PageLoader } from '../LoadingSpinner';

describe('LoadingSpinner', () => {
  it('should render an SVG spinner', () => {
    const { container } = render(<LoadingSpinner />);
    const svg = container.querySelector('svg');
    expect(svg).toBeDefined();
    expect(svg?.classList.contains('animate-spin')).toBe(true);
  });

  describe('Size variants', () => {
    it('should render small size', () => {
      const { container } = render(<LoadingSpinner size="sm" />);
      const svg = container.querySelector('svg');
      expect(svg?.classList.contains('w-4')).toBe(true);
      expect(svg?.classList.contains('h-4')).toBe(true);
    });

    it('should render medium size by default', () => {
      const { container } = render(<LoadingSpinner />);
      const svg = container.querySelector('svg');
      expect(svg?.classList.contains('w-6')).toBe(true);
      expect(svg?.classList.contains('h-6')).toBe(true);
    });

    it('should render large size', () => {
      const { container } = render(<LoadingSpinner size="lg" />);
      const svg = container.querySelector('svg');
      expect(svg?.classList.contains('w-10')).toBe(true);
      expect(svg?.classList.contains('h-10')).toBe(true);
    });
  });

  it('should accept custom className', () => {
    const { container } = render(<LoadingSpinner className="custom-class" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.classList.contains('custom-class')).toBe(true);
  });

  it('should have proper SVG structure', () => {
    const { container } = render(<LoadingSpinner />);
    const circle = container.querySelector('circle');
    const path = container.querySelector('path');
    
    expect(circle).toBeDefined();
    expect(path).toBeDefined();
  });
});

describe('PageLoader', () => {
  it('should render loading spinner', () => {
    const { container } = render(<PageLoader />);
    const svg = container.querySelector('svg.animate-spin');
    expect(svg).toBeDefined();
  });

  it('should show "Loading..." text', () => {
    render(<PageLoader />);
    expect(screen.getByText('Loading...')).toBeDefined();
  });

  it('should use large spinner size', () => {
    const { container } = render(<PageLoader />);
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('w-10')).toBe(true);
    expect(svg?.classList.contains('h-10')).toBe(true);
  });

  it('should be centered with min height', () => {
    const { container } = render(<PageLoader />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('min-h-[60vh]');
    expect(wrapper.className).toContain('flex');
    expect(wrapper.className).toContain('items-center');
    expect(wrapper.className).toContain('justify-center');
  });
});
