import { createContext } from 'react'

// A single native modal owns the stack. Links inside it push a page rather
// than presenting another native modal (which is unreliable on iOS).
export const PreviewNavigation = createContext<((path: string, inlineImage?: string) => void) | null>(null)
