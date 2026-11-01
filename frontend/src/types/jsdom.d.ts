declare module 'jsdom' {
  export class CookieJar {
    setCookieSync(cookie: string, url: string): void
    getCookiesSync(url: string, options?: { http?: boolean }): Array<{
      key: string
      httpOnly: boolean
    }>
  }

  export class JSDOM {
    constructor(
      html?: string,
      options?: { url?: string; cookieJar?: CookieJar }
    )
    window: {
      document: { cookie: string }
      close(): void
    }
  }
}
