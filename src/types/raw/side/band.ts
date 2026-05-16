export interface IBandUnifiedResponse {
  ok: number
  data: {
    realtime: BandItem[]
    hotgovs: unknown[]
    hotgov?: unknown
  }
}

export interface BandItem {
  word: string
  num: number
  category: string
  label_name?: string
  icon_desc?: string
  flag?: number
  word_scheme?: string
  [key: string]: unknown
}
