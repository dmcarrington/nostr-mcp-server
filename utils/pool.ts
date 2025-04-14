import { SimplePool } from "nostr-tools/pool";

/**
 * Create a fresh SimplePool instance for making Nostr requests
 * @returns A new SimplePool instance
 */
export function getFreshPool(): SimplePool {
  return new SimplePool();
}

/**
 * Interface for Nostr events
 */
export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/**
 * Interface for Nostr filter parameters
 */
export interface NostrFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  [key: `#${string}`]: string[];
} 