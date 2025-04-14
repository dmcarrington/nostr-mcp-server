import { hexToNpub } from './conversion.js';

/**
 * Format a pubkey for display, converting to npub format
 * @param pubkey The pubkey in hex format
 * @param useShortFormat Whether to use a shortened format
 * @returns The formatted pubkey
 */
export function formatPubkey(pubkey: string, useShortFormat = false): string {
  try {
    if (!pubkey) return 'unknown';
    
    // Convert to npub
    const npub = hexToNpub(pubkey);
    
    // If converting to npub failed, return a shortened hex
    if (!npub) {
      return useShortFormat 
        ? `${pubkey.substring(0, 4)}...${pubkey.substring(60)}` 
        : pubkey;
    }
    
    // Return appropriately formatted npub
    if (useShortFormat) {
      // For short format, show the first 8 and last 4 characters of the npub
      return `${npub.substring(0, 8)}...${npub.substring(npub.length - 4)}`;
    } else {
      // For regular format, use the full npub
      return npub;
    }
  } catch (error) {
    console.error('Error formatting pubkey:', error);
    return 'error';
  }
} 