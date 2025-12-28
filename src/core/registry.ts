import type { ISNSProvider, Logger } from '../types/core'

export class ProviderRegistry {
  private providers: Map<string, ISNSProvider> = new Map()

  constructor(private logger: Logger) {}

  public register(provider: ISNSProvider): void {
    if (this.providers.has(provider.platformName)) {
      this.logger.warn(`Overwriting existing provider for platform: ${provider.platformName}`)
    }
    this.providers.set(provider.platformName, provider)
    this.logger.debug(`Provider registered: ${provider.platformName}`)
  }

  public get(platformName: string): ISNSProvider {
    const provider = this.providers.get(platformName)
    if (!provider) {
      throw new Error(`No provider registered for platform: ${platformName}. Please ensure the plugin is loaded.`)
    }
    return provider
  }

  public getAll(): string[] {
    return Array.from(this.providers.keys())
  }

  public has(platformName: string): boolean {
    return this.providers.has(platformName)
  }
}
