import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRoutingStore } from '~/application/stores/routing-store'
import { DEFAULT_PREFERENCES } from '~/domain/entities/route'
import type { RoutePreferences } from '~/domain/entities/route'
import { BottomSheet } from './BottomSheet'

vi.mock('~/presentation/hooks/useBikeLanes', () => ({
  useBikeLanes: () => ({
    fetch: vi.fn(),
    isLoading: false,
    lastFetchedAt: null,
    isAreaTooLarge: false,
  }),
}))

vi.mock('~/presentation/hooks/useRoute', () => ({
  useRoute: () => ({
    suggest: vi.fn(),
    clear: vi.fn(),
    currentRoute: null,
    isCalculating: false,
  }),
}))

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  useRoutingStore.setState({ preferences: { ...DEFAULT_PREFERENCES } })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('BottomSheet preferences', () => {
  it('debounces and persists gap tolerance changes', () => {
    render(<BottomSheet />)
    fireEvent.click(screen.getByText('Preferences'))

    const slider = screen.getByRole('slider', { name: 'Gap tolerance' })
    fireEvent.change(slider, { target: { value: '300' } })

    expect(screen.getByText('300 m')).toBeInTheDocument()
    expect(useRoutingStore.getState().preferences.maxGapMeters).toBe(200)

    act(() => vi.advanceTimersByTime(200))

    expect(useRoutingStore.getState().preferences.maxGapMeters).toBe(300)
    const persisted = JSON.parse(localStorage.getItem('cycle-routing') ?? '{}') as {
      state?: { preferences?: RoutePreferences }
    }
    expect(persisted.state?.preferences?.maxGapMeters).toBe(300)
  })
})
