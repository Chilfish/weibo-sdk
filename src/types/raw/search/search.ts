export interface ISearchUsersResponse {
  ok: number
  data: {
    users: unknown[]
    total: number
    page: number
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface ISearchTweetsResponse {
  ok: number
  data: {
    tweets: unknown[]
    total: number
    page: number
    [key: string]: unknown
  }
  [key: string]: unknown
}
