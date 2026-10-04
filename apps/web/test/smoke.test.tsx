import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../src/App';

describe('@vo/web smoke', () => {
  it('renders the application title', () => {
    render(<App />);
    expect(screen.getByText('AI Virtual Office')).toBeInTheDocument();
  });

  it('has the jsdom stubs from test/setup.ts', () => {
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(false);
    expect(typeof ResizeObserver).toBe('function');
  });
});
