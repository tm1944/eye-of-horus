import { APIProvider, Map, Marker } from '@vis.gl/react-google-maps'
import { useEffect, useState } from 'react'
import { DeckOverlayStub } from './DeckOverlayStub'
import type { Event, EventsResponse } from './types'

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:43124'
const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''
const MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID ?? ''

function project(lng: number, lat: number) {
  const x = ((lng + 180) / 360) * 100
  const y = ((90 - lat) / 180) * 100
  return { x, y }
}

function App() {
  const [events, setEvents] = useState<Event[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [sourceStatus, setSourceStatus] = useState<Record<string, string>>({})

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${API_BASE}/events?fixture=1`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`API ${response.status} from ${API_BASE}`)
        }
        return (await response.json()) as EventsResponse
      })
      .then((payload) => {
        setEvents(payload.events)
        setSourceStatus(payload.sourceStatus)
        setStatus('ready')
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') {
          return
        }
        setStatus('error')
        setError(cause instanceof Error ? cause.message : 'API failure')
      })
    return () => controller.abort()
  }, [])

  return (
    <div className="app">
      <header className="bar">
        <div>
          <p className="kicker">Hypothesis Globe</p>
          <h1>Open sensors, checked hypotheses</h1>
        </div>
        <p className="meta">
          {status === 'loading' && 'Loading fixtures…'}
          {status === 'ready' && `${events.length} events · snowflake ${sourceStatus.snowflake ?? 'unknown'}`}
          {status === 'error' && 'API error'}
        </p>
      </header>

      {!MAPS_KEY && (
        <div className="banner" role="status">
          Set <code>VITE_GOOGLE_MAPS_API_KEY</code> in <code>apps/web/.env.local</code>. Enable Maps
          JavaScript API. Optional <code>VITE_GOOGLE_MAPS_MAP_ID</code> turns on vector tiles.
          The map shell still mounts so fixture points stay visible.
        </div>
      )}

      {status === 'error' && (
        <div className="banner error" role="alert">
          FastAPI failed ({error}). Start the API on {API_BASE} or check the failing source in{' '}
          <code>sourceStatus</code>.
        </div>
      )}

      {status === 'ready' && events.length === 0 && (
        <div className="banner" role="status">
          No events in this range.
        </div>
      )}

      <div className="workspace">
        <div className="map-root" id="map-root">
          {MAPS_KEY ? (
            <APIProvider apiKey={MAPS_KEY}>
              <Map
                defaultCenter={{ lat: 20, lng: 10 }}
                defaultZoom={2}
                gestureHandling="greedy"
                disableDefaultUI={false}
                mapId={MAP_ID || undefined}
                colorScheme="DARK"
                style={{ width: '100%', height: '100%' }}
              >
                {events.map((event) => (
                  <Marker
                    key={event.id}
                    position={{ lat: event.lat, lng: event.lng }}
                    title={event.title}
                  />
                ))}
                <DeckOverlayStub />
              </Map>
            </APIProvider>
          ) : (
            <div className="fallback-map" aria-label="Fixture point preview without a Maps key">
              {events.map((event) => {
                const point = project(event.lng, event.lat)
                return (
                  <span
                    key={event.id}
                    className={`dot ${event.layerId}`}
                    style={{ left: `${point.x}%`, top: `${point.y}%` }}
                    title={event.title}
                  />
                )
              })}
            </div>
          )}
        </div>

        <aside className="panel">
          <h2>Fixture events</h2>
          {status === 'loading' && <p className="empty">Fetching GET /events…</p>}
          <ul>
            {events.map((event) => (
              <li key={event.id}>
                <p className="layer">{event.layerId}</p>
                <p className="title">{event.title}</p>
                <p className="coords">
                  {event.lat.toFixed(2)}, {event.lng.toFixed(2)} · {event.geoSource}
                </p>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  )
}

export default App
