#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import WebSocket from "ws";
import { SimplePool } from "nostr-tools/pool";
import { decode } from "light-bolt11-decoder";

// Type definitions for Nostr
interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

interface NostrFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  [key: `#${string}`]: string[];
}

interface NostrProfile {
  name?: string;
  display_name?: string;
  displayName?: string;
  about?: string;
  picture?: string;
  banner?: string;
  nip05?: string;
  lud06?: string;
  lud16?: string;
  website?: string;
  [k: string]: unknown;
}

// Zap-specific interfaces based on NIP-57
interface ZapRequest {
  kind: 9734;
  content: string;
  tags: string[][];
  pubkey: string;
  id: string;
  sig: string;
  created_at: number;
}

interface ZapReceipt {
  kind: 9735;
  content: string;
  tags: string[][];
  pubkey: string;
  id: string;
  sig: string;
  created_at: number;
}

interface ZapRequestData {
  pubkey: string;
  content: string;
  created_at: number;
  id: string;
  amount?: number;
  relays?: string[];
  event?: string;
  lnurl?: string;
}

// Set global WebSocket implementation for Node.js
(globalThis as any).WebSocket = WebSocket;

// Define event kinds
const KINDS = {
  Metadata: 0,
  Text: 1,
  ZapRequest: 9734,
  ZapReceipt: 9735
};

// Define default relays
const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://nos.lol",
  "wss://relay.current.fyi",
  "wss://nostr.bitcoiner.social"
];

// Create server instance
const server = new McpServer({
  name: "nostr",
  version: "1.0.0",
});

// Set a reasonable timeout for queries
const QUERY_TIMEOUT = 8000;

// Helper function to get a fresh pool for each request
function getFreshPool(): SimplePool {
  return new SimplePool();
}

// Helper function to format profile data
function formatProfile(profile: NostrEvent): string {
  if (!profile) return "No profile found";
  
  let metadata: NostrProfile = {};
  try {
    metadata = profile.content ? JSON.parse(profile.content) : {};
  } catch (e) {
    console.error("Error parsing profile metadata:", e);
  }
  
  return [
    `Name: ${metadata.name || "Unknown"}`,
    `Display Name: ${metadata.display_name || metadata.displayName || metadata.name || "Unknown"}`,
    `About: ${metadata.about || "No about information"}`,
    `NIP-05: ${metadata.nip05 || "Not set"}`,
    `Picture: ${metadata.picture || "No picture"}`,
    `Website: ${metadata.website || "No website"}`,
    `Created At: ${new Date(profile.created_at * 1000).toISOString()}`,
  ].join("\n");
}

// Helper function to format note content
function formatNote(note: NostrEvent): string {
  if (!note) return "";
  
  const created = new Date(note.created_at * 1000).toLocaleString();
  
  return [
    `ID: ${note.id}`,
    `Created: ${created}`,
    `Content: ${note.content}`,
    `---`,
  ].join("\n");
}

// Parse zap request data from description tag in zap receipt
function parseZapRequestData(zapReceipt: NostrEvent): ZapRequestData | undefined {
  try {
    // Find the description tag which contains the zap request JSON
    const descriptionTag = zapReceipt.tags.find(tag => tag[0] === "description" && tag.length > 1);
    
    if (!descriptionTag || !descriptionTag[1]) {
      return undefined;
    }
    
    // Parse the zap request JSON
    const zapRequestData: ZapRequestData = JSON.parse(descriptionTag[1]);
    
    return zapRequestData;
  } catch (error) {
    console.error("Error parsing zap request data:", error);
    return undefined;
  }
}

// Helper function to extract and decode bolt11 invoice from a zap receipt
function decodeBolt11FromZap(zapReceipt: NostrEvent): any | undefined {
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
function getAmountFromDecodedInvoice(decodedInvoice: any): number | undefined {
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

// Helper function to format zap receipt with enhanced information
function formatZapReceipt(zap: NostrEvent): string {
  if (!zap) return "";
  
  try {
    // Get basic zap info
    const created = new Date(zap.created_at * 1000).toLocaleString();
    const sender = zap.pubkey.slice(0, 8) + "..." + zap.pubkey.slice(-8);
    
    // Parse the zap request data from description tag
    const zapRequestData = parseZapRequestData(zap);
    
    // Decode the bolt11 invoice
    const decodedInvoice = decodeBolt11FromZap(zap);
    
    // Get amount from either the decoded invoice or the zap request data
    let amount: string = "Unknown";
    let amountSats: number | undefined;
    
    if (decodedInvoice) {
      amountSats = getAmountFromDecodedInvoice(decodedInvoice);
      if (amountSats !== undefined) {
        amount = `${amountSats} sats`;
      }
    } else if (zapRequestData?.amount) {
      amountSats = Math.floor(zapRequestData.amount / 1000);
      amount = `${amountSats} sats`;
    }
    
    // Get the comment if available
    let comment = zapRequestData?.content || "No comment";
    
    // Check if this zap is for a specific event
    let zapTarget = "User";
    let eventId = "";
    
    // Look for an e tag in the zap receipt
    const eventTag = zap.tags.find(tag => tag[0] === "e" && tag.length > 1);
    if (eventTag && eventTag[1]) {
      zapTarget = "Event";
      eventId = eventTag[1];
    } else if (zapRequestData?.event) {
      zapTarget = "Event";
      eventId = zapRequestData.event;
    }
    
    // Format the output with all available information
    const lines = [
      `From: ${sender}`,
      `Amount: ${amount}`,
      `Created: ${created}`,
      `Target: ${zapTarget}${eventId ? ` (${eventId.slice(0, 8)}...)` : ''}`,
      `Comment: ${comment}`,
    ];
    
    // Add payment preimage if available
    const preimageTag = zap.tags.find(tag => tag[0] === "preimage" && tag.length > 1);
    if (preimageTag && preimageTag[1]) {
      lines.push(`Preimage: ${preimageTag[1].slice(0, 10)}...`);
    }
    
    // Add payment hash if available in bolt11 invoice
    if (decodedInvoice) {
      const paymentHashSection = decodedInvoice.sections.find((section: any) => section.name === "payment_hash");
      if (paymentHashSection) {
        lines.push(`Payment Hash: ${paymentHashSection.value.slice(0, 10)}...`);
      }
    }
    
    lines.push('---');
    
    return lines.join("\n");
  } catch (error) {
    console.error("Error formatting zap receipt:", error);
    return "Error formatting zap receipt";
  }
}

// Register Nostr tools
server.tool(
  "getProfile",
  "Get a Nostr profile by public key",
  {
    pubkey: z.string().describe("Public key of the Nostr user (hex format)"),
    relays: z.array(z.string()).optional().describe("Optional list of relays to query"),
  },
  async ({ pubkey, relays }) => {
    const relaysToUse = relays || DEFAULT_RELAYS;
    // Create a fresh pool for this request
    const pool = getFreshPool();
    
    try {
      console.error(`Fetching profile for ${pubkey} from ${relaysToUse.join(", ")}`);
      
      // Create a timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timeout")), QUERY_TIMEOUT);
      });
      
      // Create a query promise for profile (kind 0)
      const profilePromise = pool.get(
        relaysToUse,
        {
          kinds: [KINDS.Metadata],
          authors: [pubkey],
        } as NostrFilter
      );
      
      // Race the promises
      const profile = await Promise.race([profilePromise, timeoutPromise]) as NostrEvent;
      
      if (!profile) {
        return {
          content: [
            {
              type: "text",
              text: "No profile found for this public key",
            },
          ],
        };
      }
      
      const formatted = formatProfile(profile);
      
      return {
        content: [
          {
            type: "text",
            text: formatted,
          },
        ],
      };
    } catch (error) {
      console.error("Error fetching profile:", error);
      
      return {
        content: [
          {
            type: "text",
            text: `Error fetching profile: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    } finally {
      // Clean up any subscriptions and close the pool
      pool.close(relaysToUse);
    }
  },
);

server.tool(
  "getKind1Notes",
  "Get text notes (kind 1) by public key",
  {
    pubkey: z.string().describe("Public key of the Nostr user (hex format)"),
    limit: z.number().min(1).max(100).default(10).describe("Maximum number of notes to fetch"),
    relays: z.array(z.string()).optional().describe("Optional list of relays to query"),
  },
  async ({ pubkey, limit, relays }) => {
    const relaysToUse = relays || DEFAULT_RELAYS;
    // Create a fresh pool for this request
    const pool = getFreshPool();
    
    try {
      console.error(`Fetching kind 1 notes for ${pubkey} from ${relaysToUse.join(", ")}`);
      
      // Use the querySync method with a timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timeout")), QUERY_TIMEOUT);
      });
      
      const notesPromise = pool.querySync(
        relaysToUse,
        {
          kinds: [KINDS.Text],
          authors: [pubkey],
          limit,
        } as NostrFilter
      );
      
      const notes = await Promise.race([notesPromise, timeoutPromise]) as NostrEvent[];
      
      if (!notes || notes.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No notes found for this public key",
            },
          ],
        };
      }
      
      // Sort notes by created_at in descending order (newest first)
      notes.sort((a, b) => b.created_at - a.created_at);
      
      const formattedNotes = notes.map(formatNote).join("\n");
      
      return {
        content: [
          {
            type: "text",
            text: `Found ${notes.length} notes from ${pubkey}:\n\n${formattedNotes}`,
          },
        ],
      };
    } catch (error) {
      console.error("Error fetching notes:", error);
      
      return {
        content: [
          {
            type: "text",
            text: `Error fetching notes: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    } finally {
      // Clean up any subscriptions and close the pool
      pool.close(relaysToUse);
    }
  },
);

server.tool(
  "getReceivedZaps",
  "Get zaps received by a public key",
  {
    pubkey: z.string().describe("Public key of the Nostr user (hex format)"),
    limit: z.number().min(1).max(100).default(10).describe("Maximum number of zaps to fetch"),
    relays: z.array(z.string()).optional().describe("Optional list of relays to query"),
  },
  async ({ pubkey, limit, relays }) => {
    const relaysToUse = relays || DEFAULT_RELAYS;
    // Create a fresh pool for this request
    const pool = getFreshPool();
    
    try {
      console.error(`Fetching zaps for ${pubkey} from ${relaysToUse.join(", ")}`);
      
      // Use the querySync method with a timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timeout")), QUERY_TIMEOUT);
      });
      
      const zapsPromise = pool.querySync(
        relaysToUse,
        {
          kinds: [KINDS.ZapReceipt],
          "#p": [pubkey],
          limit,
        } as NostrFilter
      );
      
      const zaps = await Promise.race([zapsPromise, timeoutPromise]) as NostrEvent[];
      
      if (!zaps || zaps.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No zaps found for this public key",
            },
          ],
        };
      }
      
      // Sort zaps by created_at in descending order (newest first)
      zaps.sort((a, b) => b.created_at - a.created_at);
      
      const formattedZaps = zaps.map(formatZapReceipt).join("\n");
      
      return {
        content: [
          {
            type: "text",
            text: `Found ${zaps.length} zaps for ${pubkey}:\n\n${formattedZaps}`,
          },
        ],
      };
    } catch (error) {
      console.error("Error fetching zaps:", error);
      
      return {
        content: [
          {
            type: "text",
            text: `Error fetching zaps: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    } finally {
      // Clean up any subscriptions and close the pool
      pool.close(relaysToUse);
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Nostr MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
}); 