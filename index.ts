#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import WebSocket from "ws";
import { searchNips, formatNipResult } from "./nips/nips-tools.js";
import {
  NostrEvent,
  NostrFilter,
  KINDS,
  DEFAULT_RELAYS,
  QUERY_TIMEOUT,
  getFreshPool,
  npubToHex,
  formatPubkey
} from "./utils/index.js";
import {
  ZapReceipt,
  formatZapReceipt,
  processZapReceipt,
  validateZapReceipt,
  prepareAnonymousZap,
  sendAnonymousZapToolConfig,
  getReceivedZapsToolConfig,
  getSentZapsToolConfig,
  getAllZapsToolConfig
} from "./zap/zap-tools.js";
import {
  formatProfile,
  formatNote,
  getProfileToolConfig,
  getKind1NotesToolConfig,
  getKind3078NotesToolConfig,
  getLongFormNotesToolConfig
} from "./note/note-tools.js";

// Set WebSocket implementation for Node.js
(globalThis as any).WebSocket = WebSocket;

// Create server instance
const server = new McpServer({
  name: "nostr",
  version: "1.0.0",
});

// Register Nostr tools
server.tool(
  "getProfile",
  "Get a Nostr profile by public key",
  getProfileToolConfig,
  async ({ pubkey, relays }, extra) => {
    // Convert npub to hex if needed
    const hexPubkey = npubToHex(pubkey);
    if (!hexPubkey) {
      return {
        content: [
          {
            type: "text",
            text: "Invalid public key format. Please provide a valid hex pubkey or npub.",
          },
        ],
      };
    }
    
    // Generate a friendly display version of the pubkey
    const displayPubkey = formatPubkey(hexPubkey);
    
    const relaysToUse = relays || DEFAULT_RELAYS;
    // Create a fresh pool for this request
    const pool = getFreshPool();
    
    try {
      console.error(`Fetching profile for ${hexPubkey} from ${relaysToUse.join(", ")}`);
      
      // Create a timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timeout")), QUERY_TIMEOUT);
      });
      
      // Create a query promise for profile (kind 0)
      const profilePromise = pool.get(
        relaysToUse,
        {
          kinds: [KINDS.Metadata],
          authors: [hexPubkey],
        } as NostrFilter
      );
      
      // Race the promises
      const profile = await Promise.race([profilePromise, timeoutPromise]) as NostrEvent;
      
      if (!profile) {
        return {
          content: [
            {
              type: "text",
              text: `No profile found for ${displayPubkey}`,
            },
          ],
        };
      }
      
      const formatted = formatProfile(profile);
      
      return {
        content: [
          {
            type: "text",
            text: `Profile for ${displayPubkey}:\n\n${formatted}`,
          },
        ],
      };
    } catch (error) {
      console.error("Error fetching profile:", error);
      
      return {
        content: [
          {
            type: "text",
            text: `Error fetching profile for ${displayPubkey}: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    } finally {
      // Clean up any subscriptions and close the pool
      pool.close(relaysToUse);
    }
  }
);

server.tool(
  "getKind1Notes",
  "Get text notes (kind 1) by public key",
  getKind1NotesToolConfig,
  async ({ pubkey, limit, relays }, extra) => {
    // Convert npub to hex if needed
    const hexPubkey = npubToHex(pubkey);
    if (!hexPubkey) {
      return {
        content: [
          {
            type: "text",
            text: "Invalid public key format. Please provide a valid hex pubkey or npub.",
          },
        ],
      };
    }
    
    // Generate a friendly display version of the pubkey
    const displayPubkey = formatPubkey(hexPubkey);
    
    const relaysToUse = relays || DEFAULT_RELAYS;
    // Create a fresh pool for this request
    const pool = getFreshPool();
    
    try {
      console.error(`Fetching kind 1 notes for ${hexPubkey} from ${relaysToUse.join(", ")}`);
      
      // Use the querySync method with a timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timeout")), QUERY_TIMEOUT);
      });
      
      const notesPromise = pool.querySync(
        relaysToUse,
        {
          kinds: [KINDS.Text],
          authors: [hexPubkey],
          limit,
        } as NostrFilter
      );
      
      const notes = await Promise.race([notesPromise, timeoutPromise]) as NostrEvent[];
      
      if (!notes || notes.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No notes found for ${displayPubkey}`,
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
            text: `Found ${notes.length} notes from ${displayPubkey}:\n\n${formattedNotes}`,
          },
        ],
      };
    } catch (error) {
      console.error("Error fetching notes:", error);
      
      return {
        content: [
          {
            type: "text",
            text: `Error fetching notes for ${displayPubkey}: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    } finally {
      // Clean up any subscriptions and close the pool
      pool.close(relaysToUse);
    }
  }
);

server.tool(
  "getKind30078Notes",
  "Get AppSpecificData notes (kind 30078) by public key",
  getKind3078NotesToolConfig,
  async ({ pubkey, limit, relays }, extra) => {
    // Convert npub to hex if needed
    const hexPubkey = npubToHex(pubkey);
    if (!hexPubkey) {
      return {
        content: [
          {
            type: "text",
            text: "Invalid public key format. Please provide a valid hex pubkey or npub.",
          },
        ],
      };
    }
    
    // Generate a friendly display version of the pubkey
    const displayPubkey = formatPubkey(hexPubkey);
    
    const relaysToUse = relays || DEFAULT_RELAYS;
    // Create a fresh pool for this request
    const pool = getFreshPool();
    
    try {
      console.error(`Fetching kind 30078 notes for ${hexPubkey} from ${relaysToUse.join(", ")}`);
      
      // Use the querySync method with a timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timeout")), QUERY_TIMEOUT);
      });
      
      const notesPromise = pool.querySync(
        relaysToUse,
        {
          kinds: [KINDS.AppSpecificData],
          authors: [hexPubkey],
          limit,
        } as NostrFilter
      );
      
      const notes = await Promise.race([notesPromise, timeoutPromise]) as NostrEvent[];
      
      if (!notes || notes.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No notes found for ${displayPubkey}`,
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
            text: `Found ${notes.length} notes from ${displayPubkey}:\n\n${formattedNotes}`,
          },
        ],
      };
    } catch (error) {
      console.error("Error fetching notes:", error);
      
      return {
        content: [
          {
            type: "text",
            text: `Error fetching notes for ${displayPubkey}: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    } finally {
      // Clean up any subscriptions and close the pool
      pool.close(relaysToUse);
    }
  }
);

server.tool(
  "getReceivedZaps",
  "Get zaps received by a public key",
  getReceivedZapsToolConfig,
  async ({ pubkey, limit, relays, validateReceipts, debug }) => {
    // Convert npub to hex if needed
    const hexPubkey = npubToHex(pubkey);
    if (!hexPubkey) {
      return {
        content: [
          {
            type: "text",
            text: "Invalid public key format. Please provide a valid hex pubkey or npub.",
          },
        ],
      };
    }
    
    // Generate a friendly display version of the pubkey
    const displayPubkey = formatPubkey(hexPubkey);
    
    const relaysToUse = relays || DEFAULT_RELAYS;
    // Create a fresh pool for this request
    const pool = getFreshPool();
    
    try {
      console.error(`Fetching zaps for ${hexPubkey} from ${relaysToUse.join(", ")}`);
      
      // Use the querySync method with a timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timeout")), QUERY_TIMEOUT);
      });
      
      // Use the proper filter with lowercase 'p' tag which indicates recipient
      const zapsPromise = pool.querySync(
        relaysToUse,
        {
          kinds: [KINDS.ZapReceipt],
          "#p": [hexPubkey], // lowercase 'p' for recipient
          limit: Math.ceil(limit * 1.5), // Fetch a bit more to account for potential invalid zaps
        } as NostrFilter
      );
      
      const zaps = await Promise.race([zapsPromise, timeoutPromise]) as NostrEvent[];
      
      if (!zaps || zaps.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No zaps found for ${displayPubkey}`,
            },
          ],
        };
      }
      
      if (debug) {
        console.error(`Retrieved ${zaps.length} raw zap receipts`);
      }
      
      // Process and optionally validate zaps
      let processedZaps: any[] = [];
      let invalidCount = 0;
      
      for (const zap of zaps) {
        try {
          // Process the zap receipt with context of the target pubkey
          const processedZap = processZapReceipt(zap as ZapReceipt, hexPubkey);
          
          // Skip zaps that aren't actually received by this pubkey
          if (processedZap.direction !== 'received' && processedZap.direction !== 'self') {
            if (debug) {
              console.error(`Skipping zap ${zap.id.slice(0, 8)}... with direction ${processedZap.direction}`);
            }
            continue;
          }
          
          // Validate if requested
          if (validateReceipts) {
            const validationResult = validateZapReceipt(zap);
            if (!validationResult.valid) {
              if (debug) {
                console.error(`Invalid zap receipt ${zap.id.slice(0, 8)}...: ${validationResult.reason}`);
              }
              invalidCount++;
              continue;
            }
          }
          
          processedZaps.push(processedZap);
        } catch (error) {
          if (debug) {
            console.error(`Error processing zap ${zap.id.slice(0, 8)}...`, error);
          }
        }
      }
      
      if (processedZaps.length === 0) {
        let message = `No valid zaps found for ${displayPubkey}`;
        if (invalidCount > 0) {
          message += ` (${invalidCount} invalid zaps were filtered out)`;
        }
        
        return {
          content: [
            {
              type: "text",
              text: message,
            },
          ],
        };
      }
      
      // Sort zaps by created_at in descending order (newest first)
      processedZaps.sort((a, b) => b.created_at - a.created_at);
      
      // Limit to requested number
      processedZaps = processedZaps.slice(0, limit);
      
      // Calculate total sats received
      const totalSats = processedZaps.reduce((sum, zap) => sum + (zap.amountSats || 0), 0);
      
      const formattedZaps = processedZaps.map(zap => formatZapReceipt(zap, hexPubkey)).join("\n");
      
      return {
        content: [
          {
            type: "text",
            text: `Found ${processedZaps.length} zaps received by ${displayPubkey}.\nTotal received: ${totalSats} sats\n\n${formattedZaps}`,
          },
        ],
      };
    } catch (error) {
      console.error("Error fetching zaps:", error);
      
      return {
        content: [
          {
            type: "text",
            text: `Error fetching zaps for ${displayPubkey}: ${error instanceof Error ? error.message : "Unknown error"}`,
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
  "getSentZaps",
  "Get zaps sent by a public key",
  getSentZapsToolConfig,
  async ({ pubkey, limit, relays, validateReceipts, debug }) => {
    // Convert npub to hex if needed
    const hexPubkey = npubToHex(pubkey);
    if (!hexPubkey) {
      return {
        content: [
          {
            type: "text",
            text: "Invalid public key format. Please provide a valid hex pubkey or npub.",
          },
        ],
      };
    }
    
    // Generate a friendly display version of the pubkey
    const displayPubkey = formatPubkey(hexPubkey);
    
    const relaysToUse = relays || DEFAULT_RELAYS;
    // Create a fresh pool for this request
    const pool = getFreshPool();
    
    try {
      console.error(`Fetching sent zaps for ${hexPubkey} from ${relaysToUse.join(", ")}`);
      
      // Use the querySync method with a timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timeout")), QUERY_TIMEOUT);
      });
      
      // First try the direct and correct approach: query with uppercase 'P' tag (NIP-57)
      if (debug) console.error("Trying direct query with #P tag...");
      const directSentZapsPromise = pool.querySync(
        relaysToUse,
        {
          kinds: [KINDS.ZapReceipt],
          "#P": [hexPubkey], // uppercase 'P' for sender
          limit: Math.ceil(limit * 1.5), // Fetch a bit more to account for potential invalid zaps
        } as NostrFilter
      );
      
      let potentialSentZaps: NostrEvent[] = [];
      try {
        potentialSentZaps = await Promise.race([directSentZapsPromise, timeoutPromise]) as NostrEvent[];
        if (debug) console.error(`Direct #P tag query returned ${potentialSentZaps.length} results`);
      } catch (e: unknown) {
        if (debug) console.error(`Direct #P tag query failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      
      // If the direct query didn't return enough results, try the fallback method
      if (!potentialSentZaps || potentialSentZaps.length < limit) {
        if (debug) console.error("Direct query yielded insufficient results, trying fallback approach...");
        
        // Try a fallback approach - fetch a larger set of zap receipts
        const zapsPromise = pool.querySync(
          relaysToUse,
          {
            kinds: [KINDS.ZapReceipt],
            limit: Math.max(limit * 10, 100), // Get a larger sample
          } as NostrFilter
        );
        
        const additionalZaps = await Promise.race([zapsPromise, timeoutPromise]) as NostrEvent[];
        
        if (debug) {
          console.error(`Retrieved ${additionalZaps?.length || 0} additional zap receipts to analyze`);
        }
        
        if (additionalZaps && additionalZaps.length > 0) {
          // Add these to our potential sent zaps
          potentialSentZaps = [...potentialSentZaps, ...additionalZaps];
        }
      }
      
      if (!potentialSentZaps || potentialSentZaps.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No zap receipts found to analyze",
              },
            ],
          };
        }
        
      // Process and filter zaps
      let processedZaps: any[] = [];
      let invalidCount = 0;
      let nonSentCount = 0;
      
      if (debug) {
        console.error(`Processing ${potentialSentZaps.length} potential sent zaps...`);
      }
      
      // Process each zap to determine if it was sent by the target pubkey
      for (const zap of potentialSentZaps) {
        try {
          // Process the zap receipt with context of the target pubkey
          const processedZap = processZapReceipt(zap as ZapReceipt, hexPubkey);
          
          // Skip zaps that aren't sent by this pubkey
          if (processedZap.direction !== 'sent' && processedZap.direction !== 'self') {
            if (debug) {
              console.error(`Skipping zap ${zap.id.slice(0, 8)}... with direction ${processedZap.direction}`);
            }
            nonSentCount++;
            continue;
          }
          
          // Validate if requested
          if (validateReceipts) {
            const validationResult = validateZapReceipt(zap);
            if (!validationResult.valid) {
              if (debug) {
                console.error(`Invalid zap receipt ${zap.id.slice(0, 8)}...: ${validationResult.reason}`);
              }
              invalidCount++;
              continue;
            }
          }
          
          processedZaps.push(processedZap);
          } catch (error) {
            if (debug) {
            console.error(`Error processing zap ${zap.id.slice(0, 8)}...`, error);
          }
        }
      }
      
      // Deduplicate by zap ID
      const uniqueZaps = new Map<string, any>();
      processedZaps.forEach(zap => uniqueZaps.set(zap.id, zap));
      processedZaps = Array.from(uniqueZaps.values());
      
      if (processedZaps.length === 0) {
        let message = `No zaps sent by ${displayPubkey} were found.`;
        if (invalidCount > 0 || nonSentCount > 0) {
          message += ` (${invalidCount} invalid zaps and ${nonSentCount} non-sent zaps were filtered out)`;
        }
        message += " This could be because:\n1. The user hasn't sent any zaps\n2. The zap receipts don't properly contain the sender's pubkey\n3. The relays queried don't have this data";
        
        return {
          content: [
            {
              type: "text",
              text: message,
            },
          ],
        };
      }
      
      // Sort zaps by created_at in descending order (newest first)
      processedZaps.sort((a, b) => b.created_at - a.created_at);
      
      // Limit to requested number
      processedZaps = processedZaps.slice(0, limit);
      
      // Calculate total sats sent
      const totalSats = processedZaps.reduce((sum, zap) => sum + (zap.amountSats || 0), 0);
      
      // For debugging, examine the first zap in detail
      if (debug && processedZaps.length > 0) {
        const firstZap = processedZaps[0];
        console.error("Sample sent zap:", JSON.stringify(firstZap, null, 2));
      }
      
      const formattedZaps = processedZaps.map(zap => formatZapReceipt(zap, hexPubkey)).join("\n");
      
      return {
        content: [
          {
            type: "text",
            text: `Found ${processedZaps.length} zaps sent by ${displayPubkey}.\nTotal sent: ${totalSats} sats\n\n${formattedZaps}`,
          },
        ],
      };
    } catch (error) {
      console.error("Error fetching sent zaps:", error);
      
      return {
        content: [
          {
            type: "text",
            text: `Error fetching sent zaps for ${displayPubkey}: ${error instanceof Error ? error.message : "Unknown error"}`,
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
  "getAllZaps",
  "Get all zaps (sent and received) for a public key",
  getAllZapsToolConfig,
  async ({ pubkey, limit, relays, validateReceipts, debug }) => {
    // Convert npub to hex if needed
    const hexPubkey = npubToHex(pubkey);
    if (!hexPubkey) {
      return {
        content: [
          {
            type: "text",
            text: "Invalid public key format. Please provide a valid hex pubkey or npub.",
          },
        ],
      };
    }
    
    // Generate a friendly display version of the pubkey
    const displayPubkey = formatPubkey(hexPubkey);
    
    const relaysToUse = relays || DEFAULT_RELAYS;
    // Create a fresh pool for this request
    const pool = getFreshPool();
    
    try {
      console.error(`Fetching all zaps for ${hexPubkey} from ${relaysToUse.join(", ")}`);
      
      // Use a more efficient approach: fetch all potentially relevant zaps in parallel
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timeout")), QUERY_TIMEOUT);
      });
      
      // Prepare all required queries in parallel to reduce total time
      const fetchPromises = [
        // 1. Fetch received zaps (lowercase 'p' tag)
        pool.querySync(
        relaysToUse,
        {
          kinds: [KINDS.ZapReceipt],
          "#p": [hexPubkey],
            limit: Math.ceil(limit * 1.5),
        } as NostrFilter
        ),
        
        // 2. Fetch sent zaps (uppercase 'P' tag)
        pool.querySync(
        relaysToUse,
        {
          kinds: [KINDS.ZapReceipt],
          "#P": [hexPubkey],
            limit: Math.ceil(limit * 1.5),
        } as NostrFilter
        )
      ];
      
      // Add a general query if we're in debug mode or need more comprehensive results
      if (debug) {
        fetchPromises.push(
          pool.querySync(
          relaysToUse,
          {
            kinds: [KINDS.ZapReceipt],
              limit: Math.max(limit * 5, 50),
          } as NostrFilter
          )
        );
      }
      
      // Execute all queries in parallel
      const results = await Promise.allSettled(fetchPromises);
      
      // Collect all zaps from successful queries
      const allZaps: NostrEvent[] = [];
      
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const zaps = result.value as NostrEvent[];
        if (debug) {
            const queryTypes = ['Received', 'Sent', 'General'];
            console.error(`${queryTypes[index]} query returned ${zaps.length} results`);
          }
          allZaps.push(...zaps);
        } else if (debug) {
          const queryTypes = ['Received', 'Sent', 'General'];
          console.error(`${queryTypes[index]} query failed:`, result.reason);
        }
      });
      
      if (allZaps.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No zaps found for ${displayPubkey}. Try specifying different relays that might have the data.`,
            },
          ],
        };
      }
      
      if (debug) {
        console.error(`Retrieved ${allZaps.length} total zaps before deduplication`);
      }
      
      // Deduplicate by zap ID
      const uniqueZapsMap = new Map<string, NostrEvent>();
      allZaps.forEach(zap => uniqueZapsMap.set(zap.id, zap));
      const uniqueZaps = Array.from(uniqueZapsMap.values());
      
      if (debug) {
        console.error(`Deduplicated to ${uniqueZaps.length} unique zaps`);
      }
      
      // Process each zap to determine its relevance to the target pubkey
      let processedZaps: any[] = [];
      let invalidCount = 0;
      let irrelevantCount = 0;
      
      for (const zap of uniqueZaps) {
        try {
          // Process the zap with the target pubkey as context
          const processedZap = processZapReceipt(zap as ZapReceipt, hexPubkey);
          
          // Skip zaps that are neither sent nor received by this pubkey
          if (processedZap.direction === 'unknown') {
              if (debug) {
              console.error(`Skipping irrelevant zap ${zap.id.slice(0, 8)}...`);
            }
            irrelevantCount++;
            continue;
          }
          
          // Validate if requested
          if (validateReceipts) {
            const validationResult = validateZapReceipt(zap);
            if (!validationResult.valid) {
            if (debug) {
                console.error(`Invalid zap receipt ${zap.id.slice(0, 8)}...: ${validationResult.reason}`);
            }
              invalidCount++;
              continue;
          }
          }
        
          processedZaps.push(processedZap);
        } catch (error) {
        if (debug) {
            console.error(`Error processing zap ${zap.id.slice(0, 8)}...`, error);
          }
        }
      }
      
      if (processedZaps.length === 0) {
        let message = `No relevant zaps found for ${displayPubkey}.`;
        if (invalidCount > 0 || irrelevantCount > 0) {
          message += ` (${invalidCount} invalid zaps and ${irrelevantCount} irrelevant zaps were filtered out)`;
        }
        
        return {
          content: [
            {
              type: "text",
              text: message,
            },
          ],
        };
      }
      
      // Sort zaps by created_at in descending order (newest first)
      processedZaps.sort((a, b) => b.created_at - a.created_at);
      
      // Calculate statistics: sent, received, and self zaps
      const sentZaps = processedZaps.filter(zap => zap.direction === 'sent');
      const receivedZaps = processedZaps.filter(zap => zap.direction === 'received');
      const selfZaps = processedZaps.filter(zap => zap.direction === 'self');
      
      // Calculate total sats
      const totalSent = sentZaps.reduce((sum, zap) => sum + (zap.amountSats || 0), 0);
      const totalReceived = receivedZaps.reduce((sum, zap) => sum + (zap.amountSats || 0), 0);
      const totalSelfZaps = selfZaps.reduce((sum, zap) => sum + (zap.amountSats || 0), 0);
      
      // Limit to requested number for display
      processedZaps = processedZaps.slice(0, limit);
      
      // Format the zaps with the pubkey context
      const formattedZaps = processedZaps.map(zap => formatZapReceipt(zap, hexPubkey)).join("\n");
      
      // Prepare summary statistics
      const summary = [
        `Zap Summary for ${displayPubkey}:`,
        `- ${sentZaps.length} zaps sent (${totalSent} sats)`,
        `- ${receivedZaps.length} zaps received (${totalReceived} sats)`,
        `- ${selfZaps.length} self-zaps (${totalSelfZaps} sats)`,
        `- Net balance: ${totalReceived - totalSent} sats`,
        `\nShowing ${processedZaps.length} most recent zaps:\n`
      ].join("\n");
      
      return {
        content: [
          {
            type: "text",
            text: `${summary}\n${formattedZaps}`,
          },
        ],
      };
    } catch (error) {
      console.error("Error fetching all zaps:", error);
      
      return {
        content: [
          {
            type: "text",
            text: `Error fetching all zaps for ${displayPubkey}: ${error instanceof Error ? error.message : "Unknown error"}`,
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
  "getLongFormNotes",
  "Get long-form notes (kind 30023) by public key",
  getLongFormNotesToolConfig,
  async ({ pubkey, limit, relays }, extra) => {
    // Convert npub to hex if needed
    const hexPubkey = npubToHex(pubkey);
    if (!hexPubkey) {
      return {
        content: [
          {
            type: "text",
            text: "Invalid public key format. Please provide a valid hex pubkey or npub.",
          },
        ],
      };
    }
    
    // Generate a friendly display version of the pubkey
    const displayPubkey = formatPubkey(hexPubkey);
    
    const relaysToUse = relays || DEFAULT_RELAYS;
    // Create a fresh pool for this request
    const pool = getFreshPool();
    
    try {
      console.error(`Fetching long-form notes for ${hexPubkey} from ${relaysToUse.join(", ")}`);
      
      // Use the querySync method with a timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timeout")), QUERY_TIMEOUT);
      });
      
      const notesPromise = pool.querySync(
        relaysToUse,
        {
          kinds: [30023], // NIP-23 long-form content
          authors: [hexPubkey],
          limit,
        } as NostrFilter
      );
      
      const notes = await Promise.race([notesPromise, timeoutPromise]) as NostrEvent[];
      
      if (!notes || notes.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No long-form notes found for ${displayPubkey}`,
            },
          ],
        };
      }
      
      // Sort notes by created_at in descending order (newest first)
      notes.sort((a, b) => b.created_at - a.created_at);
      
      // Format each note with enhanced metadata
      const formattedNotes = notes.map(note => {
        // Extract metadata from tags
        const title = note.tags.find(tag => tag[0] === "title")?.[1] || "Untitled";
        const image = note.tags.find(tag => tag[0] === "image")?.[1];
        const summary = note.tags.find(tag => tag[0] === "summary")?.[1];
        const publishedAt = note.tags.find(tag => tag[0] === "published_at")?.[1];
        const identifier = note.tags.find(tag => tag[0] === "d")?.[1];
        
        // Format the output
        const lines = [
          `Title: ${title}`,
          `Created: ${new Date(note.created_at * 1000).toLocaleString()}`,
          publishedAt ? `Published: ${new Date(parseInt(publishedAt) * 1000).toLocaleString()}` : null,
          image ? `Image: ${image}` : null,
          summary ? `Summary: ${summary}` : null,
          identifier ? `Identifier: ${identifier}` : null,
          `Content:`,
          note.content,
          `---`,
        ].filter(Boolean).join("\n");
        
        return lines;
      }).join("\n\n");
      
      return {
        content: [
          {
            type: "text",
            text: `Found ${notes.length} long-form notes from ${displayPubkey}:\n\n${formattedNotes}`,
          },
        ],
      };
    } catch (error) {
      console.error("Error fetching long-form notes:", error);
      
      return {
        content: [
          {
            type: "text",
            text: `Error fetching long-form notes for ${displayPubkey}: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    } finally {
      // Clean up any subscriptions and close the pool
      pool.close(relaysToUse);
    }
  }
);

server.tool(
  "searchNips",
  "Search through Nostr Implementation Possibilities (NIPs)",
  {
    query: z.string().describe("Search query to find relevant NIPs"),
    limit: z.number().min(1).max(50).default(10).describe("Maximum number of results to return"),
    includeContent: z.boolean().default(false).describe("Whether to include the full content of each NIP in the results"),
  },
  async ({ query, limit, includeContent }) => {
    try {
      console.error(`Searching NIPs for: "${query}"`);
      
      const results = await searchNips(query, limit);
      
      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No NIPs found matching "${query}". Try different search terms or check the NIPs repository for the latest updates.`,
            },
          ],
        };
      }
      
      // Format results using the new formatter
      const formattedResults = results.map(result => formatNipResult(result, includeContent)).join("\n\n");
      
      return {
        content: [
          {
            type: "text",
            text: `Found ${results.length} matching NIPs:\n\n${formattedResults}`,
          },
        ],
      };
    } catch (error) {
      console.error("Error searching NIPs:", error);
      
      return {
        content: [
          {
            type: "text",
            text: `Error searching NIPs: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  },
);

server.tool(
  "sendAnonymousZap",
  "Prepare an anonymous zap to a profile or event",
  sendAnonymousZapToolConfig,
  async ({ target, amountSats, comment, relays }) => {
    // Use supplied relays or defaults
    const relaysToUse = relays || DEFAULT_RELAYS;
    
    try {
      console.error(`Preparing anonymous zap to ${target} for ${amountSats} sats`);
      
      // Prepare the anonymous zap
      const zapResult = await prepareAnonymousZap(target, amountSats, comment, relaysToUse);
      
      if (!zapResult || !zapResult.success) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to prepare anonymous zap: ${zapResult?.message || "Unknown error"}`,
            },
          ],
        };
      }
      
      return {
        content: [
          {
            type: "text",
            text: `Anonymous zap prepared successfully!\n\nAmount: ${amountSats} sats${comment ? `\nComment: "${comment}"` : ""}\nTarget: ${target}\n\nInvoice:\n${zapResult.invoice}\n\nCopy this invoice into your Lightning wallet to pay. After payment, the recipient will receive the zap anonymously.`,
          },
        ],
      };
    } catch (error) {
      console.error("Error in sendAnonymousZap tool:", error);
      
      let errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      // Provide a more helpful message for common errors
      if (errorMessage.includes("ENOTFOUND") || errorMessage.includes("ETIMEDOUT")) {
        errorMessage = `Could not connect to the Lightning service. This might be a temporary network issue or the service might be down. Error: ${errorMessage}`;
      } else if (errorMessage.includes("Timeout")) {
        errorMessage = "The operation timed out. This might be due to slow relays or network connectivity issues.";
      }
      
      return {
        content: [
          {
            type: "text",
            text: `Error preparing anonymous zap: ${errorMessage}`,
          },
        ],
      };
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

// Add handlers for unexpected termination
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  // Don't exit - keep the server running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  // Don't exit - keep the server running
}); 