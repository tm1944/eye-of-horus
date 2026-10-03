export type LayerId =
  | 'earthquake'
  | 'wildfire'
  | 'conflict'
  | 'politics'
  | 'terror'
  | 'finance'
  | 'humanitarian'
  | 'news'

export type EventEntity = {
  type: string
  text: string
  confidence: number
}

export type Event = {
  id: string
  source: string
  sourceUrl: string | null
  layerId: LayerId
  title: string
  summary: string | null
  occurredAt: string
  updatedAt: string
  lng: number
  lat: number
  altM: number | null
  geoPrecision: string
  geoSource: string
  weight: number
  significance: number
  entities: EventEntity[]
  rawRef: string | null
}

export type EventsResponse = {
  generatedAt: string
  sourceStatus: Record<string, string>
  events: Event[]
  nextCursor: string | null
}
