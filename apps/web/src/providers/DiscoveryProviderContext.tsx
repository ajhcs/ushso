import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import type { DiscoveryResult } from '../types/discovery'
import { createDefaultDiscoveryProvider, DiscoveryProviderError, type DiscoveryProvider } from './discoveryProvider'

const defaultProvider = createDefaultDiscoveryProvider()
const DiscoveryProviderContext = createContext<DiscoveryProvider>(defaultProvider)

export function DiscoveryProviderBoundary({ children, provider = defaultProvider }: { children: ReactNode; provider?: DiscoveryProvider }) {
  return <DiscoveryProviderContext.Provider value={provider}>{children}</DiscoveryProviderContext.Provider>
}

export function useDiscoveryProvider() {
  return useContext(DiscoveryProviderContext)
}

type DiscoveryLoadState =
  | { status: 'loading'; result: null; error: null }
  | { status: 'ready'; result: DiscoveryResult; error: null }
  | { status: 'error'; result: null; error: DiscoveryProviderError }

export function useDiscoveryResult(question: string): DiscoveryLoadState {
  const provider = useDiscoveryProvider()
  const [state, setState] = useState<DiscoveryLoadState>({ status: 'loading', result: null, error: null })

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading', result: null, error: null })
    const request = question.trim()
      ? provider.discover({ question, limit: 50 }, { signal: controller.signal })
      : provider.browse({ signal: controller.signal })
    request.then(
      (result) => setState({ status: 'ready', result, error: null }),
      (error: unknown) => {
        if (controller.signal.aborted) return
        const providerError = error instanceof DiscoveryProviderError
          ? error
          : new DiscoveryProviderError('invalid_contract', 'The discovery provider returned an unexpected error.')
        setState({ status: 'error', result: null, error: providerError })
      },
    )
    return () => controller.abort()
  }, [provider, question])

  return state
}

export function useDatasetResult(datasetId: string): DiscoveryLoadState {
  const provider = useDiscoveryProvider()
  const [state, setState] = useState<DiscoveryLoadState>({ status: 'loading', result: null, error: null })

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading', result: null, error: null })
    provider.dataset(datasetId, { signal: controller.signal }).then(
      (result) => setState({ status: 'ready', result, error: null }),
      (error: unknown) => {
        if (controller.signal.aborted) return
        const providerError = error instanceof DiscoveryProviderError
          ? error
          : new DiscoveryProviderError('invalid_contract', 'The discovery provider returned an unexpected error.')
        setState({ status: 'error', result: null, error: providerError })
      },
    )
    return () => controller.abort()
  }, [datasetId, provider])

  return state
}
