// Set a reasonable timeout for queries
export const QUERY_TIMEOUT = 8000;

// Define default relays
export const DEFAULT_RELAYS = [
  "wss://nostr.everledger.io",
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://relay.primal.net",
  "wss://nos.lol",
  "wss://purplerelay.com",
  "wss://nostr.land"
];

// Add more popular relays that we can try if the default ones fail
export const FALLBACK_RELAYS = [
  "wss://nostr.mom",
  "wss://nostr.noones.com",
  "wss://nostr-pub.wellorder.net",
  "wss://nostr.bitcoiner.social",
  "wss://at.nostrworks.com",
  "wss://lightningrelay.com",
];

// Define event kinds
export const KINDS = {
  Metadata: 0,
  Text: 1,
  ZapRequest: 9734,
  ZapReceipt: 9735,
  AppSpecificData: 30078
}; 