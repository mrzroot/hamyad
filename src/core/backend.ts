export interface RawFile {
  /** path relative to the brain dir, forward slashes */
  path: string;
  content: string;
  sha?: string;
}

/** Storage abstraction. Implementations: filesystem (local repo), GitHub API, memory. */
export interface Backend {
  readonly label: string;
  /** Return every file below the brain dir (recursive, text only). */
  readAll(): Promise<RawFile[]>;
  /** Create or replace a file. `sha` is the previous version token when updating. */
  write(path: string, content: string, message: string, sha?: string): Promise<{ sha?: string }>;
}

export class MemoryBackend implements Backend {
  readonly label = "memory";
  files = new Map<string, string>();
  writes: { path: string; message: string }[] = [];
  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) this.files.set(k, v);
  }
  async readAll(): Promise<RawFile[]> {
    return [...this.files].map(([path, content]) => ({ path, content }));
  }
  async write(path: string, content: string, message: string) {
    this.files.set(path, content);
    this.writes.push({ path, message });
    return {};
  }
}
