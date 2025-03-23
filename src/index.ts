#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import WebSocket from "ws";
import { SimplePool } from "nostr-tools/pool";

// Set global WebSocket implementation for Node.js
(globalThis as any).WebSocket = WebSocket;

// Define event kinds
const KINDS = {
  Metadata: 0,
  Text: 1,
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
function getFreshPool() {
  return new SimplePool();
}

// Helper function to format profile data
function formatProfile(profile: any): string {
  if (!profile) return "No profile found";
  
  const metadata = profile.content ? JSON.parse(profile.content) : {};
  
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
function formatNote(note: any): string {
  if (!note) return "";
  
  const created = new Date(note.created_at * 1000).toLocaleString();
  
  return [
    `ID: ${note.id}`,
    `Created: ${created}`,
    `Content: ${note.content}`,
    `---`,
  ].join("\n");
}

// Helper function to format zap receipt
function formatZapReceipt(zap: any): string {
  if (!zap) return "";
  
  try {
    // Extract amount from the zap
    const zapRequest = zap.tags.find((tag: string[]) => tag[0] === "description");
    let description: any = {};
    let amount = "Unknown";

    if (zapRequest && zapRequest[1]) {
      try {
        description = JSON.parse(zapRequest[1]);
        const bolt11Tag = zap.tags.find((tag: string[]) => tag[0] === "bolt11");
        if (bolt11Tag && bolt11Tag[1] && description.amount) {
          // For simplicity, we're extracting from the description, but in real implementation
          // you'd want to decode the bolt11 invoice
          amount = `${description.amount / 1000} sats`;
        }
      } catch(e) {
        console.error("Error parsing zap description", e);
      }
    }
    
    const created = new Date(zap.created_at * 1000).toLocaleString();
    const sender = zap.pubkey.slice(0, 8) + "..." + zap.pubkey.slice(-8);
    
    return [
      `From: ${sender}`,
      `Amount: ${amount}`,
      `Created: ${created}`,
      `---`,
    ].join("\n");
  } catch (error) {
    console.error("Error formatting zap receipt", error);
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
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Timeout")), QUERY_TIMEOUT);
      });
      
      // Create a query promise for profile (kind 0)
      const profilePromise = pool.get(
        relaysToUse,
        {
          kinds: [KINDS.Metadata],
          authors: [pubkey],
        }
      );
      
      // Race the promises
      const profile = await Promise.race([profilePromise, timeoutPromise]);
      
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
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Timeout")), QUERY_TIMEOUT);
      });
      
      const notesPromise = pool.querySync(
        relaysToUse,
        {
          kinds: [KINDS.Text],
          authors: [pubkey],
          limit,
        }
      );
      
      const notes = await Promise.race([notesPromise, timeoutPromise]) as any[];
      
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
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Timeout")), QUERY_TIMEOUT);
      });
      
      const zapsPromise = pool.querySync(
        relaysToUse,
        {
          kinds: [KINDS.ZapReceipt],
          "#p": [pubkey],
          limit,
        }
      );
      
      const zaps = await Promise.race([zapsPromise, timeoutPromise]) as any[];
      
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