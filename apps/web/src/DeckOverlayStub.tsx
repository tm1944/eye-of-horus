import { GoogleMapsOverlay } from '@deck.gl/google-maps'
import { useMap } from '@vis.gl/react-google-maps'
import { useEffect } from 'react'

/** Thin mount of GoogleMapsOverlay. HeatmapLayer / ScatterplotLayer land in #6. */
export function DeckOverlayStub() {
  const map = useMap()

  useEffect(() => {
    if (!map) {
      return
    }
    const overlay = new GoogleMapsOverlay({ layers: [] })
    overlay.setMap(map)
    return () => {
      overlay.setMap(null)
    }
  }, [map])

  return null
}
