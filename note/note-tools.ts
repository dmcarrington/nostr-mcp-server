import { z } from "zod";
import {
  NostrEvent
} from "../utils/index.js";

// Schema for getProfile tool
export const getProfileToolConfig = {
  pubkey: z.string().describe("Public key of the Nostr user (hex format or npub format)"),
  relays: z.array(z.string()).optional().describe("Optional list of relays to query"),
};

// Schema for getKind1Notes tool
export const getKind1NotesToolConfig = {
  pubkey: z.string().describe("Public key of the Nostr user (hex format or npub format)"),
  limit: z.number().min(1).max(100).default(10).describe("Maximum number of notes to fetch"),
  relays: z.array(z.string()).optional().describe("Optional list of relays to query"),
};

// Schema for getLongFormNotes tool
export const getLongFormNotesToolConfig = {
  pubkey: z.string().describe("Public key of the Nostr user (hex format or npub format)"),
  limit: z.number().min(1).max(100).default(10).describe("Maximum number of notes to fetch"),
  relays: z.array(z.string()).optional().describe("Optional list of relays to query"),
};

// Helper function to format profile data
export function formatProfile(profile: NostrEvent): string {
  if (!profile) return "No profile found";
  
  let metadata: any = {};
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
    `Lightning Address (LUD-16): ${metadata.lud16 || "Not set"}`,
    `LNURL (LUD-06): ${metadata.lud06 || "Not set"}`,
    `Picture: ${metadata.picture || "No picture"}`,
    `Website: ${metadata.website || "No website"}`,
    `Created At: ${new Date(profile.created_at * 1000).toISOString()}`,
  ].join("\n");
}

// Helper function to format note content
export function formatNote(note: NostrEvent): string {
  if (!note) return "";
  
  const created = new Date(note.created_at * 1000).toLocaleString();
  
  return [
    `ID: ${note.id}`,
    `Created: ${created}`,
    `Content: ${note.content}`,
    `---`,
  ].join("\n");
} 