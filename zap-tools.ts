import { z } from "zod";
import { decode } from "light-bolt11-decoder";
import * as nip19 from "nostr-tools/nip19";
import { SimplePool } from "nostr-tools/pool";

// Set a reasonable timeout for queries
export const QUERY_TIMEOUT = 8000;

// Define default relays
export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://relay.primal.net",
  "wss://nos.lol",
  "wss://relay.current.fyi",
  "wss://nostr.bitcoiner.social"
];

// Type definitions for Nostr
export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface NostrFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  [key: `#${string}`]: string[];
}

// Define event kinds
export const KINDS = {
  Metadata: 0,
  Text: 1,
  ZapRequest: 9734,
  ZapReceipt: 9735
};

// Zap-specific interfaces based on NIP-57
export interface ZapRequest {
  kind: 9734;
  content: string;
  tags: string[][];
  pubkey: string;
  id: string;
  sig: string;
  created_at: number;
}

export interface ZapReceipt {
  kind: 9735;
  content: string;
  tags: string[][];
  pubkey: string;
  id: string;
  sig: string;
  created_at: number;
}

export interface ZapRequestData {
  pubkey: string;
  content: string;
  created_at: number;
  id: string;
  amount?: number;
  relays?: string[];
  event?: string;
  lnurl?: string;
}

// Define a zap direction type for better code clarity
export type ZapDirection = 'sent' | 'received' | 'self' | 'unknown';

// Define a cached zap type that includes direction
export interface CachedZap extends ZapReceipt {
  direction?: ZapDirection;
  amountSats?: number;
  targetPubkey?: string;
  targetEvent?: string;
  targetCoordinate?: string;
  processedAt: number;
}

// Simple cache implementation for zap receipts
export class ZapCache {
  private cache: Map<string, CachedZap> = new Map();
  private maxSize: number;
  private ttlMs: number;
  
  constructor(maxSize = 1000, ttlMinutes = 10) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMinutes * 60 * 1000;
  }
  
  add(zapReceipt: ZapReceipt, enrichedData?: Partial<CachedZap>): CachedZap {
    // Create enriched zap with processing timestamp
    const cachedZap: CachedZap = {
      ...zapReceipt,
      ...enrichedData,
      processedAt: Date.now()
    };
    
    // Add to cache
    this.cache.set(zapReceipt.id, cachedZap);
    
    // Clean cache if it exceeds max size
    if (this.cache.size > this.maxSize) {
      this.cleanup();
    }
    
    return cachedZap;
  }
  
  get(id: string): CachedZap | undefined {
    const cachedZap = this.cache.get(id);
    
    // Return undefined if not found or expired
    if (!cachedZap || Date.now() - cachedZap.processedAt > this.ttlMs) {
      if (cachedZap) {
        // Remove expired entry
        this.cache.delete(id);
      }
      return undefined;
    }
    
    return cachedZap;
  }
  
  has(id: string): boolean {
    return this.get(id) !== undefined;
  }
  
  cleanup(): void {
    const now = Date.now();
    
    // Remove expired entries
    for (const [id, zap] of this.cache.entries()) {
      if (now - zap.processedAt > this.ttlMs) {
        this.cache.delete(id);
      }
    }
    
    // If still too large, remove oldest entries
    if (this.cache.size > this.maxSize) {
      const sortedEntries = Array.from(this.cache.entries())
        .sort((a, b) => a[1].processedAt - b[1].processedAt);
      
      const entriesToRemove = sortedEntries.slice(0, sortedEntries.length - Math.floor(this.maxSize * 0.75));
      
      for (const [id] of entriesToRemove) {
        this.cache.delete(id);
      }
    }
  }
  
  clear(): void {
    this.cache.clear();
  }
  
  size(): number {
    return this.cache.size;
  }
}

// Create a global cache instance
export const zapCache = new ZapCache();

// Helper function to get a fresh pool for each request
export function getFreshPool(): SimplePool {
  return new SimplePool();
}

// Helper function to convert npub to hex
export function npubToHex(pubkey: string): string | null {
  if (!pubkey) return null;
  
  try {
    // Clean up input
    pubkey = pubkey.trim();
    
    // Check if the input is already a hex key (case insensitive check, but return lowercase)
    if (/^[0-9a-fA-F]{64}$/i.test(pubkey)) {
      return pubkey.toLowerCase();
    }
    
    // Check if the input is an npub
    if (pubkey.startsWith('npub1')) {
      try {
        const { type, data } = nip19.decode(pubkey);
        if (type === 'npub') {
          return data as string;
        }
      } catch (decodeError) {
        console.error("Error decoding npub:", decodeError);
        return null;
      }
    }
    
    // Not a valid pubkey format
    return null;
  } catch (error) {
    console.error("Error converting npub to hex:", error);
    return null;
  }
}

// Helper function to convert hex to npub
export function hexToNpub(hex: string): string | null {
  if (!hex) return null;
  
  try {
    // Clean up input
    hex = hex.trim();
    
    // Check if the input is already an npub
    if (hex.startsWith('npub1')) {
      // Validate that it's a proper npub by trying to decode it
      try {
        const { type } = nip19.decode(hex);
        if (type === 'npub') {
          return hex;
        }
      } catch (e) {
        // Not a valid npub
        return null;
      }
    }
    
    // Check if the input is a valid hex key (case insensitive, but convert to lowercase)
    if (/^[0-9a-fA-F]{64}$/i.test(hex)) {
      try {
        return nip19.npubEncode(hex.toLowerCase());
      } catch (encodeError) {
        console.error("Error encoding hex to npub:", encodeError);
        return null;
      }
    }
    
    // Not a valid hex key
    return null;
  } catch (error) {
    console.error("Error converting hex to npub:", error);
    return null;
  }
}

// Helper function to format public key for display
export function formatPubkey(pubkey: string, useShortFormat = false): string {
  if (!pubkey) return "Unknown";
  
  try {
    // Clean up input
    pubkey = pubkey.trim();
    
    // Get npub representation if we have a hex key
    let npub: string | null = null;
    
    if (pubkey.startsWith('npub1')) {
      // Validate that it's a proper npub
      try {
        const { type } = nip19.decode(pubkey);
        if (type === 'npub') {
          npub = pubkey;
        }
      } catch (e) {
        // Not a valid npub, fall back to original
        return pubkey;
      }
    } else if (/^[0-9a-fA-F]{64}$/i.test(pubkey)) {
      // Convert hex to npub
      npub = hexToNpub(pubkey);
    }
    
    // If we couldn't get a valid npub, return the original
    if (!npub) {
      return pubkey;
    }
    
    // Format according to preference
    if (useShortFormat) {
      // Short format: npub1abc...xyz
      return `${npub.slice(0, 8)}...${npub.slice(-4)}`;
    } else {
      // Full format: npub1abc...xyz (hex)
      const hex = npubToHex(npub);
      if (hex) {
        return `${npub} (${hex.slice(0, 6)}...${hex.slice(-6)})`;
      } else {
        return npub;
      }
    }
  } catch (error) {
    // Return original on error
    console.error("Error formatting pubkey:", error);
    return pubkey;
  }
}

// Parse zap request data from description tag in zap receipt
export function parseZapRequestData(zapReceipt: NostrEvent): ZapRequestData | undefined {
  try {
    // Find the description tag which contains the zap request JSON
    const descriptionTag = zapReceipt.tags.find(tag => tag[0] === "description" && tag.length > 1);
    
    if (!descriptionTag || !descriptionTag[1]) {
      return undefined;
    }
    
    // Parse the zap request JSON - this contains a serialized ZapRequest
    const zapRequest: ZapRequest = JSON.parse(descriptionTag[1]);
    
    // Convert to the ZapRequestData format
    const zapRequestData: ZapRequestData = {
      pubkey: zapRequest.pubkey,
      content: zapRequest.content,
      created_at: zapRequest.created_at,
      id: zapRequest.id,
    };
    
    // Extract additional data from ZapRequest tags
    zapRequest.tags.forEach(tag => {
      if (tag[0] === 'amount' && tag[1]) {
        zapRequestData.amount = parseInt(tag[1], 10);
      } else if (tag[0] === 'relays' && tag.length > 1) {
        zapRequestData.relays = tag.slice(1);
      } else if (tag[0] === 'e' && tag[1]) {
        zapRequestData.event = tag[1];
      } else if (tag[0] === 'lnurl' && tag[1]) {
        zapRequestData.lnurl = tag[1];
      }
    });
    
    return zapRequestData;
  } catch (error) {
    console.error("Error parsing zap request data:", error);
    return undefined;
  }
}

// Helper function to extract and decode bolt11 invoice from a zap receipt
export function decodeBolt11FromZap(zapReceipt: NostrEvent): any | undefined {
  try {
    // Find the bolt11 tag
    const bolt11Tag = zapReceipt.tags.find(tag => tag[0] === "bolt11" && tag.length > 1);
    
    if (!bolt11Tag || !bolt11Tag[1]) {
      return undefined;
    }
    
    // Decode the bolt11 invoice
    const decodedInvoice = decode(bolt11Tag[1]);
    
    return decodedInvoice;
  } catch (error) {
    console.error("Error decoding bolt11 invoice:", error);
    return undefined;
  }
}

// Extract amount in sats from decoded bolt11 invoice
export function getAmountFromDecodedInvoice(decodedInvoice: any): number | undefined {
  try {
    if (!decodedInvoice || !decodedInvoice.sections) {
      return undefined;
    }
    
    // Find the amount section
    const amountSection = decodedInvoice.sections.find((section: any) => section.name === "amount");
    
    if (!amountSection) {
      return undefined;
    }
    
    // Convert msats to sats
    const amountMsats = amountSection.value;
    const amountSats = Math.floor(amountMsats / 1000);
    
    return amountSats;
  } catch (error) {
    console.error("Error extracting amount from decoded invoice:", error);
    return undefined;
  }
}

// Validate a zap receipt according to NIP-57 Appendix F
export function validateZapReceipt(zapReceipt: NostrEvent, zapRequest?: ZapRequest): { valid: boolean, reason?: string } {
  try {
    // 1. Must be kind 9735
    if (zapReceipt.kind !== KINDS.ZapReceipt) {
      return { valid: false, reason: "Not a zap receipt (kind 9735)" };
    }
    
    // 2. Must have a bolt11 tag
    const bolt11Tag = zapReceipt.tags.find(tag => tag[0] === "bolt11" && tag.length > 1);
    if (!bolt11Tag || !bolt11Tag[1]) {
      return { valid: false, reason: "Missing bolt11 tag" };
    }
    
    // 3. Must have a description tag with the zap request
    const descriptionTag = zapReceipt.tags.find(tag => tag[0] === "description" && tag.length > 1);
    if (!descriptionTag || !descriptionTag[1]) {
      return { valid: false, reason: "Missing description tag" };
    }
    
    // 4. Parse the zap request from the description tag if not provided
    let parsedZapRequest: ZapRequest;
    try {
      parsedZapRequest = zapRequest || JSON.parse(descriptionTag[1]);
    } catch (e) {
      return { valid: false, reason: "Invalid zap request JSON in description tag" };
    }
    
    // 5. Validate the zap request structure
    if (parsedZapRequest.kind !== KINDS.ZapRequest) {
      return { valid: false, reason: "Invalid zap request kind" };
    }
    
    // 6. Check that the p tag from the zap request is included in the zap receipt
    const requestedRecipientPubkey = parsedZapRequest.tags.find(tag => tag[0] === 'p' && tag.length > 1)?.[1];
    const receiptRecipientTag = zapReceipt.tags.find(tag => tag[0] === 'p' && tag.length > 1);
    
    if (!requestedRecipientPubkey || !receiptRecipientTag || receiptRecipientTag[1] !== requestedRecipientPubkey) {
      return { valid: false, reason: "Recipient pubkey mismatch" };
    }
    
    // 7. Check for optional e tag consistency if present in the zap request
    const requestEventTag = parsedZapRequest.tags.find(tag => tag[0] === 'e' && tag.length > 1);
    if (requestEventTag) {
      const receiptEventTag = zapReceipt.tags.find(tag => tag[0] === 'e' && tag.length > 1);
      if (!receiptEventTag || receiptEventTag[1] !== requestEventTag[1]) {
        return { valid: false, reason: "Event ID mismatch" };
      }
    }
    
    // 8. Check for optional amount consistency
    const amountTag = parsedZapRequest.tags.find(tag => tag[0] === 'amount' && tag.length > 1);
    if (amountTag) {
      // Decode the bolt11 invoice to verify the amount
      const decodedInvoice = decodeBolt11FromZap(zapReceipt);
      if (decodedInvoice) {
        const invoiceAmountMsats = decodedInvoice.sections.find((s: any) => s.name === "amount")?.value;
        const requestAmountMsats = parseInt(amountTag[1], 10);
        
        if (invoiceAmountMsats && Math.abs(invoiceAmountMsats - requestAmountMsats) > 10) { // Allow small rounding differences
          return { valid: false, reason: "Amount mismatch between request and invoice" };
        }
      }
    }
    
    return { valid: true };
  } catch (error) {
    return { valid: false, reason: `Validation error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// Determine the direction of a zap relative to a pubkey
export function determineZapDirection(zapReceipt: ZapReceipt, pubkey: string): ZapDirection {
  try {
    // Check if received via lowercase 'p' tag (recipient)
    const isReceived = zapReceipt.tags.some(tag => tag[0] === 'p' && tag[1] === pubkey);
    
    // Check if sent via uppercase 'P' tag (sender, per NIP-57)
    let isSent = zapReceipt.tags.some(tag => tag[0] === 'P' && tag[1] === pubkey);
    
    if (!isSent) {
      // Fallback: check description tag for the sender pubkey
      const descriptionTag = zapReceipt.tags.find(tag => tag[0] === "description" && tag.length > 1);
      if (descriptionTag && descriptionTag[1]) {
        try {
          const zapRequest: ZapRequest = JSON.parse(descriptionTag[1]);
          isSent = zapRequest && zapRequest.pubkey === pubkey;
        } catch (e) {
          // Ignore parsing errors
        }
      }
    }
    
    // Determine direction
    if (isSent && isReceived) {
      return 'self';
    } else if (isSent) {
      return 'sent';
    } else if (isReceived) {
      return 'received';
    } else {
      return 'unknown';
    }
  } catch (error) {
    console.error("Error determining zap direction:", error);
    return 'unknown';
  }
}

// Process a zap receipt into an enriched cached zap
export function processZapReceipt(zapReceipt: ZapReceipt, pubkey: string): CachedZap {
  // Check if we already have this zap in the cache
  const existingCachedZap = zapCache.get(zapReceipt.id);
  if (existingCachedZap) {
    return existingCachedZap;
  }
  
  try {
    // Determine direction relative to the specified pubkey
    const direction = determineZapDirection(zapReceipt, pubkey);
    
    // Extract target pubkey (recipient)
    const targetPubkey = zapReceipt.tags.find(tag => tag[0] === 'p' && tag.length > 1)?.[1];
    
    // Extract target event if any
    const targetEvent = zapReceipt.tags.find(tag => tag[0] === 'e' && tag.length > 1)?.[1];
    
    // Extract target coordinate if any (a tag)
    const targetCoordinate = zapReceipt.tags.find(tag => tag[0] === 'a' && tag.length > 1)?.[1];
    
    // Parse zap request to get additional data
    const zapRequestData = parseZapRequestData(zapReceipt);
    
    // Decode bolt11 invoice to get amount
    const decodedInvoice = decodeBolt11FromZap(zapReceipt);
    const amountSats = decodedInvoice ? 
      getAmountFromDecodedInvoice(decodedInvoice) : 
      (zapRequestData?.amount ? Math.floor(zapRequestData.amount / 1000) : undefined);
    
    // Create enriched zap and add to cache
    return zapCache.add(zapReceipt, {
      direction,
      amountSats,
      targetPubkey,
      targetEvent,
      targetCoordinate
    });
  } catch (error) {
    console.error("Error processing zap receipt:", error);
    // Still cache the basic zap with unknown direction
    return zapCache.add(zapReceipt, { direction: 'unknown' });
  }
}

// Helper function to format zap receipt with enhanced information
export function formatZapReceipt(zap: NostrEvent, pubkeyContext?: string): string {
  if (!zap) return "";
  
  try {
    // Cast to ZapReceipt for better type safety since we know we're dealing with kind 9735
    const zapReceipt = zap as ZapReceipt;
    
    // Process the zap receipt with context if provided
    let enrichedZap: CachedZap;
    if (pubkeyContext) {
      enrichedZap = processZapReceipt(zapReceipt, pubkeyContext);
    } else {
      // Check if it's already in cache
      const cachedZap = zapCache.get(zapReceipt.id);
      if (cachedZap) {
        enrichedZap = cachedZap;
      } else {
        // Process without context - won't have direction information
        enrichedZap = {
          ...zapReceipt,
          processedAt: Date.now()
        };
      }
    }
    
    // Get basic zap info
    const created = new Date(zapReceipt.created_at * 1000).toLocaleString();
    
    // Get sender information from P tag or description
    let sender = "Unknown";
    let senderPubkey: string | undefined;
    const senderPTag = zapReceipt.tags.find(tag => tag[0] === 'P' && tag.length > 1);
    if (senderPTag && senderPTag[1]) {
      senderPubkey = senderPTag[1];
      const npub = hexToNpub(senderPubkey);
      sender = npub ? `${npub.slice(0, 8)}...${npub.slice(-4)}` : `${senderPubkey.slice(0, 8)}...${senderPubkey.slice(-8)}`;
    } else {
      // Try to get from description
      const zapRequestData = parseZapRequestData(zapReceipt);
      if (zapRequestData?.pubkey) {
        senderPubkey = zapRequestData.pubkey;
        const npub = hexToNpub(senderPubkey);
        sender = npub ? `${npub.slice(0, 8)}...${npub.slice(-4)}` : `${senderPubkey.slice(0, 8)}...${senderPubkey.slice(-8)}`;
      }
    }
    
    // Get recipient information
    const recipient = zapReceipt.tags.find(tag => tag[0] === 'p' && tag.length > 1)?.[1];
    let formattedRecipient = "Unknown";
    if (recipient) {
      const npub = hexToNpub(recipient);
      formattedRecipient = npub ? `${npub.slice(0, 8)}...${npub.slice(-4)}` : `${recipient.slice(0, 8)}...${recipient.slice(-8)}`;
    }
    
    // Get amount
    let amount: string = enrichedZap.amountSats !== undefined ? 
      `${enrichedZap.amountSats} sats` : 
      "Unknown";
    
    // Get comment
    let comment = "No comment";
    const zapRequestData = parseZapRequestData(zapReceipt);
    if (zapRequestData?.content) {
      comment = zapRequestData.content;
    }
    
    // Check if this zap is for a specific event or coordinate
    let zapTarget = "User";
    let targetId = "";
    
    if (enrichedZap.targetEvent) {
      zapTarget = "Event";
      targetId = enrichedZap.targetEvent;
    } else if (enrichedZap.targetCoordinate) {
      zapTarget = "Replaceable Event";
      targetId = enrichedZap.targetCoordinate;
    }
    
    // Format the output with all available information
    const lines = [
      `From: ${sender}`,
      `To: ${formattedRecipient}`,
      `Amount: ${amount}`,
      `Created: ${created}`,
      `Target: ${zapTarget}${targetId ? ` (${targetId.slice(0, 8)}...)` : ''}`,
      `Comment: ${comment}`,
    ];
    
    // Add payment preimage if available
    const preimageTag = zapReceipt.tags.find(tag => tag[0] === "preimage" && tag.length > 1);
    if (preimageTag && preimageTag[1]) {
      lines.push(`Preimage: ${preimageTag[1].slice(0, 10)}...`);
    }
    
    // Add payment hash if available in bolt11 invoice
    const decodedInvoice = decodeBolt11FromZap(zapReceipt);
    if (decodedInvoice) {
      const paymentHashSection = decodedInvoice.sections.find((section: any) => section.name === "payment_hash");
      if (paymentHashSection) {
        lines.push(`Payment Hash: ${paymentHashSection.value.slice(0, 10)}...`);
      }
    }
    
    // Add direction information if available
    if (enrichedZap.direction && enrichedZap.direction !== 'unknown') {
      const directionLabels = {
        'sent': '↑ SENT',
        'received': '↓ RECEIVED',
        'self': '↻ SELF ZAP'
      };
      
      lines.unshift(`[${directionLabels[enrichedZap.direction]}]`);
    }
    
    lines.push('---');
    
    return lines.join("\n");
  } catch (error) {
    console.error("Error formatting zap receipt:", error);
    return "Error formatting zap receipt";
  }
}

// Export the tool configurations
export const getReceivedZapsToolConfig = {
  pubkey: z.string().describe("Public key of the Nostr user (hex format or npub format)"),
  limit: z.number().min(1).max(100).default(10).describe("Maximum number of zaps to fetch"),
  relays: z.array(z.string()).optional().describe("Optional list of relays to query"),
  validateReceipts: z.boolean().default(true).describe("Whether to validate zap receipts according to NIP-57"),
  debug: z.boolean().default(false).describe("Enable verbose debug logging"),
};

export const getSentZapsToolConfig = {
  pubkey: z.string().describe("Public key of the Nostr user (hex format or npub format)"),
  limit: z.number().min(1).max(100).default(10).describe("Maximum number of zaps to fetch"),
  relays: z.array(z.string()).optional().describe("Optional list of relays to query"),
  validateReceipts: z.boolean().default(true).describe("Whether to validate zap receipts according to NIP-57"),
  debug: z.boolean().default(false).describe("Enable verbose debug logging"),
};

export const getAllZapsToolConfig = {
  pubkey: z.string().describe("Public key of the Nostr user (hex format or npub format)"),
  limit: z.number().min(1).max(100).default(20).describe("Maximum number of total zaps to fetch"),
  relays: z.array(z.string()).optional().describe("Optional list of relays to query"),
  validateReceipts: z.boolean().default(true).describe("Whether to validate zap receipts according to NIP-57"),
  debug: z.boolean().default(false).describe("Enable verbose debug logging"),
}; 