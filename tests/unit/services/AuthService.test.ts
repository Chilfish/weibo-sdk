import { describe, expect, it } from 'vitest'
import { AuthService } from '~/services/internal/AuthService'

describe('authService', () => {
  it('extracts XSRF token from cookie when not provided', () => {
    const auth = new AuthService({
      cookie: 'SUB=abc; XSRF-TOKEN=token123; other=x',
    })

    const headers = auth.getAuthHeaders()
    expect(headers.Cookie).toContain('SUB=abc')
    expect(headers['X-XSRF-TOKEN']).toBe('token123')
  })

  it('prefers explicit xsrfToken over cookie extraction', () => {
    const auth = new AuthService({
      cookie: 'SUB=abc; XSRF-TOKEN=token_from_cookie',
      xsrfToken: 'token_explicit',
    })

    const headers = auth.getAuthHeaders()
    expect(headers['X-XSRF-TOKEN']).toBe('token_explicit')
  })

  it('validates cookie contains SUB', () => {
    expect(new AuthService({ cookie: 'SUB=abc' }).validate()).toBe(true)
    expect(new AuthService({ cookie: 'XSRF-TOKEN=1' }).validate()).toBe(false)
  })
})
