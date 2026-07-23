export interface CacheEntry {
  exists: boolean;
  repoName?: string;
}

export type ResolveFn = (uri: string) => Promise<CacheEntry>;

export class FsGitCache {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly resolve: ResolveFn) {}

  async get(uri: string): Promise<CacheEntry> {
    const cached = this.cache.get(uri);
    if (cached) {
      return cached;
    }
    const entry = await this.resolve(uri);
    this.cache.set(uri, entry);
    return entry;
  }

  invalidateAll(): void {
    this.cache.clear();
  }
}
