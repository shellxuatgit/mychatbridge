import { create } from 'zustand'

interface UiState {
  addProviderOpen: boolean
  setAddProviderOpen: (open: boolean) => void
}

export const useUiStore = create<UiState>((set) => ({
  addProviderOpen: false,
  setAddProviderOpen: (addProviderOpen) => set({ addProviderOpen }),
}))