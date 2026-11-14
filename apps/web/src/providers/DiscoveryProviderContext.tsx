import {fetchControlledDiscovery,type ControlledOptions,type CoverageFilter} from './controlledDiscoveryClient'
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import type { DiscoveryQuery, DiscoveryResult } from '../types/discovery'
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
  | { status: 'ready'; result: DiscoveryResult; error: null; coverage?: CoverageFilter }
  | { status: 'error'; result: null; error: DiscoveryProviderError }

export function useDiscoveryResult(question: string, request: Omit<DiscoveryQuery, 'question'> = {}, controls?: ControlledOptions): DiscoveryLoadState {
  const provider = useDiscoveryProvider()
  const [state, setState] = useState<DiscoveryLoadState>({ status: 'loading', result: null, error: null })
  const requestKey = JSON.stringify(request)
  const controlsKey = JSON.stringify(controls??null)

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading', result: null, error: null })
    const queryRequest = JSON.parse(requestKey) as Omit<DiscoveryQuery, 'question'>
    const traversal = {
      cursor: queryRequest.cursor,
      generation: queryRequest.generation,
      pageSize: queryRequest.page_size,
      sort: queryRequest.sort,
      filters: queryRequest.facet_filters
        ? Object.entries(queryRequest.facet_filters).flatMap(([section, values]) => values.map((value) => `${section}:${value}`))
        : undefined,
    }
    if(controls) {
      fetchControlledDiscovery({question,...queryRequest},JSON.parse(controlsKey),controller.signal)
        .then(value=>{if(!controller.signal.aborted)setState({status:'ready',result:value.discovery,error:null,coverage:value.coverage_filter})})
        .catch(error=>{if(!controller.signal.aborted)setState({status:'error',result:null,error:error instanceof DiscoveryProviderError?error:new DiscoveryProviderError('invalid_contract','Controlled discovery response failed.')})})
      return ()=>controller.abort()
    }
    const pending = question.trim()
      ? provider.discover({ question, ...queryRequest }, { signal: controller.signal, traversal })
      : provider.browse({ signal: controller.signal, traversal })
    pending.then(
      (result) => { if(!controller.signal.aborted)setState({ status: 'ready', result, error: null }) },
      (error: unknown) => {
        if (controller.signal.aborted) return
        const providerError = error instanceof DiscoveryProviderError
          ? error
          : new DiscoveryProviderError('invalid_contract', 'The discovery provider returned an unexpected error.')
        setState({ status: 'error', result: null, error: providerError })
      },
    )
    return () => controller.abort()
  }, [provider, question, requestKey, controlsKey])

  return state
}

export function useDatasetResult(datasetId: string): DiscoveryLoadState {
  const provider = useDiscoveryProvider()
  const [state, setState] = useState<DiscoveryLoadState>({ status: 'loading', result: null, error: null })

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading', result: null, error: null })
    provider.dataset(datasetId, { signal: controller.signal }).then(
      (result) => { if(!controller.signal.aborted)setState({ status: 'ready', result, error: null }) },
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
