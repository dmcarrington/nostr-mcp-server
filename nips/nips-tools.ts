import { z } from "zod";
import fetch from "node-fetch";
import * as fs from 'fs';
import * as path from 'path';

// Define the NIP data structure
export interface NipData {
  number: number;
  title: string;
  description: string;
  status: "draft" | "final" | "deprecated";
  kind?: number;
  tags?: string[];
  content: string;
}

// Define the search result structure
export interface NipSearchResult {
  nip: NipData;
  relevance: number;
  matchedTerms: string[];
}

// Cache configuration
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours
const CACHE_FILE = path.join(process.cwd(), 'nips-cache.json');
let nipsCache: NipData[] = [];
let lastFetchTime = 0;

// Search index
interface SearchIndex {
  titleIndex: Map<string, Set<number>>;
  descriptionIndex: Map<string, Set<number>>;
  contentIndex: Map<string, Set<number>>;
  numberIndex: Map<string, number>;
  kindIndex: Map<number, Set<number>>;
  tagIndex: Map<string, Set<number>>;
}

let searchIndex: SearchIndex = {
  titleIndex: new Map(),
  descriptionIndex: new Map(),
  contentIndex: new Map(),
  numberIndex: new Map(),
  kindIndex: new Map(),
  tagIndex: new Map()
};

interface GitHubFile {
  name: string;
  download_url: string;
}

// Load cache from disk on startup
function loadCacheFromDisk(): boolean {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const cacheData = fs.readFileSync(CACHE_FILE, 'utf8');
      const cacheObj = JSON.parse(cacheData);
      
      if (cacheObj && Array.isArray(cacheObj.nips) && typeof cacheObj.timestamp === 'number') {
        nipsCache = cacheObj.nips;
        lastFetchTime = cacheObj.timestamp;
        
        // Check if cache is fresh enough
        if (Date.now() - lastFetchTime < CACHE_TTL) {
          console.log(`Loaded ${nipsCache.length} NIPs from cache file`);
          buildSearchIndex();
          return true;
        } else {
          console.log('Cache file exists but is expired');
          // We'll still use it temporarily but will refresh
          buildSearchIndex();
          return false;
        }
      }
    }
    return false;
  } catch (error) {
    console.error('Error loading cache from disk:', error);
    return false;
  }
}

// Save cache to disk
function saveCacheToDisk(): void {
  try {
    const cacheObj = {
      nips: nipsCache,
      timestamp: lastFetchTime
    };
    
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheObj, null, 2), 'utf8');
    console.log(`Saved ${nipsCache.length} NIPs to cache file`);
  } catch (error) {
    console.error('Error saving cache to disk:', error);
  }
}

// Build search index from nips cache
function buildSearchIndex(): void {
  // Reset indexes
  searchIndex = {
    titleIndex: new Map(),
    descriptionIndex: new Map(),
    contentIndex: new Map(),
    numberIndex: new Map(),
    kindIndex: new Map(),
    tagIndex: new Map()
  };
  
  for (const nip of nipsCache) {
    // Index NIP number
    searchIndex.numberIndex.set(nip.number.toString(), nip.number);
    
    // Index title words
    const titleWords = nip.title.toLowerCase().split(/\W+/).filter(word => word.length > 0);
    for (const word of titleWords) {
      if (!searchIndex.titleIndex.has(word)) {
        searchIndex.titleIndex.set(word, new Set());
      }
      searchIndex.titleIndex.get(word)?.add(nip.number);
    }
    
    // Index description words
    const descWords = nip.description.toLowerCase().split(/\W+/).filter(word => word.length > 0);
    for (const word of descWords) {
      if (!searchIndex.descriptionIndex.has(word)) {
        searchIndex.descriptionIndex.set(word, new Set());
      }
      searchIndex.descriptionIndex.get(word)?.add(nip.number);
    }
    
    // Index content (more selective to save memory)
    const contentWords = new Set(
      nip.content.toLowerCase()
        .split(/\W+/)
        .filter(word => word.length > 3) // Only index words longer than 3 chars
    );
    
    for (const word of contentWords) {
      if (!searchIndex.contentIndex.has(word)) {
        searchIndex.contentIndex.set(word, new Set());
      }
      searchIndex.contentIndex.get(word)?.add(nip.number);
    }
    
    // Index kind
    if (nip.kind !== undefined) {
      if (!searchIndex.kindIndex.has(nip.kind)) {
        searchIndex.kindIndex.set(nip.kind, new Set());
      }
      searchIndex.kindIndex.get(nip.kind)?.add(nip.number);
    }
    
    // Index tags
    if (nip.tags) {
      for (const tag of nip.tags) {
        const normalizedTag = tag.toLowerCase().trim();
        if (!searchIndex.tagIndex.has(normalizedTag)) {
          searchIndex.tagIndex.set(normalizedTag, new Set());
        }
        searchIndex.tagIndex.get(normalizedTag)?.add(nip.number);
      }
    }
  }
  
  console.log('Built search index for NIPs');
}

// Function to fetch NIPs from GitHub with retries
async function fetchNipsFromGitHub(retries = 3): Promise<NipData[]> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Fetching NIPs from GitHub (attempt ${attempt}/${retries})`);
      
      // Fetch the NIPs directory listing
      const headers: Record<string, string> = {};
      // Use conditional request if we already have data
      if (nipsCache.length > 0) {
        headers['If-Modified-Since'] = new Date(lastFetchTime).toUTCString();
      }
      
      const response = await fetch('https://api.github.com/repos/nostr-protocol/nips/contents', { headers });
      
      // If not modified, use cache
      if (response.status === 304) {
        console.log('NIPs not modified since last fetch, using cache');
        return nipsCache;
      }
      
      if (!response.ok) throw new Error(`GitHub API error: ${response.statusText}`);
      
      const files = await response.json() as GitHubFile[];
      
      // Filter for NIP markdown files
      const nipFiles = files.filter((file: GitHubFile) => 
        file.name.match(/^\d+\.md$/) || 
        file.name.match(/^[0-9A-Fa-f]+\.md$/)
      );
      
      console.log(`Found ${nipFiles.length} NIP files to process`);
      
      // Process files in batches to avoid overwhelming the GitHub API
      const batchSize = 5;
      const nips: NipData[] = [];
      
      for (let i = 0; i < nipFiles.length; i += batchSize) {
        const batch = nipFiles.slice(i, i + batchSize);
        const batchPromises = batch.map(file => fetchNipFile(file));
        
        const batchResults = await Promise.all(batchPromises);
        const validNips = batchResults.filter((nip): nip is NipData => nip !== null);
        nips.push(...validNips);
        
        // Add a small delay between batches to avoid rate limiting
        if (i + batchSize < nipFiles.length) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      
      console.log(`Successfully processed ${nips.length} NIPs`);
      return nips;
      
    } catch (error) {
      console.error(`Error fetching NIPs from GitHub (attempt ${attempt}/${retries}):`, error);
      
      if (attempt === retries) {
        // On final retry failure, return cache if available or empty array
        console.warn('All GitHub fetch attempts failed, using cached data if available');
        return nipsCache.length > 0 ? nipsCache : [];
      }
      
      // Wait before retrying (with increasing backoff)
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
  
  return [];
}

// Helper to fetch a single NIP file
async function fetchNipFile(file: GitHubFile): Promise<NipData | null> {
  try {
    const contentResponse = await fetch(file.download_url);
    if (!contentResponse.ok) {
      console.warn(`Failed to fetch ${file.name}: ${contentResponse.statusText}`);
      return null;
    }
    
    const content = await contentResponse.text();
    const numberMatch = file.name.match(/^(\d+|[0-9A-Fa-f]+)\.md$/);
    if (!numberMatch) return null;
    
    const numberStr = numberMatch[1];
    const number = numberStr.match(/^[0-9A-Fa-f]+$/) ? 
      parseInt(numberStr, 16) : 
      parseInt(numberStr, 10);
    
    const lines = content.split('\n');
    const title = lines[0].replace(/^#\s*/, '').trim();
    const description = lines[1]?.trim() || `NIP-${number} description`;
    
    const statusMatch = content.match(/Status:\s*(draft|final|deprecated)/i);
    const status = statusMatch ? statusMatch[1].toLowerCase() as "draft" | "final" | "deprecated" : "draft";
    
    const kindMatch = content.match(/Kind:\s*(\d+)/i);
    const kind = kindMatch ? parseInt(kindMatch[1], 10) : undefined;
    
    const tags: string[] = [];
    const tagMatches = content.matchAll(/Tags:\s*([^\n]+)/gi);
    for (const match of tagMatches) {
      tags.push(...match[1].split(',').map((tag: string) => tag.trim()));
    }
    
    return {
      number,
      title,
      description,
      status,
      kind,
      tags: tags.length > 0 ? tags : undefined,
      content
    };
  } catch (error) {
    console.error(`Error processing NIP ${file.name}:`, error);
    return null;
  }
}

// Function to get NIPs with improved caching
async function getNips(forceRefresh = false): Promise<NipData[]> {
  const now = Date.now();
  
  // First attempt to load from memory cache
  if (!forceRefresh && nipsCache.length > 0 && now - lastFetchTime < CACHE_TTL) {
    return nipsCache;
  }
  
  // If no memory cache, try loading from disk
  if (!forceRefresh && nipsCache.length === 0) {
    const loaded = loadCacheFromDisk();
    if (loaded && now - lastFetchTime < CACHE_TTL) {
      return nipsCache;
    }
  }
  
  // Fetch fresh data if needed
  try {
    const nips = await fetchNipsFromGitHub();
    
    // Only update cache if we got new data
    if (nips.length > 0) {
      nipsCache = nips;
      lastFetchTime = now;
      
      // Save to disk and build search index
      saveCacheToDisk();
      buildSearchIndex();
    }
    
    return nipsCache;
  } catch (error) {
    console.error("Error refreshing NIPs:", error);
    
    // If we already have cached data, use it even if expired
    if (nipsCache.length > 0) {
      console.warn("Using expired cache due to fetch error");
      return nipsCache;
    }
    
    // Last resort - try to load from disk regardless of timestamp
    if (loadCacheFromDisk()) {
      return nipsCache;
    }
    
    // No options left
    return [];
  }
}

// Helper function to calculate relevance score using the search index
function calculateRelevance(nip: NipData, searchTerms: string[]): { score: number; matchedTerms: string[] } {
  const matchedTerms: string[] = [];
  let score = 0;
  
  // Convert search terms to lowercase for case-insensitive matching
  const lowerSearchTerms = searchTerms.map(term => term.toLowerCase());
  
  for (const term of lowerSearchTerms) {
    // Check for exact NIP number match (highest priority)
    if (nip.number.toString() === term) {
      score += 10;
      matchedTerms.push(term);
      continue;
    }
    
    // Check title matches (high weight)
    if (searchIndex.titleIndex.has(term) && 
        searchIndex.titleIndex.get(term)?.has(nip.number)) {
      score += 3;
      matchedTerms.push(term);
    }
    
    // Check description matches (medium weight)
    if (searchIndex.descriptionIndex.has(term) && 
        searchIndex.descriptionIndex.get(term)?.has(nip.number)) {
      score += 2;
      if (!matchedTerms.includes(term)) {
        matchedTerms.push(term);
      }
    }
    
    // Check content matches (lower weight)
    if (searchIndex.contentIndex.has(term) && 
        searchIndex.contentIndex.get(term)?.has(nip.number)) {
      score += 1;
      if (!matchedTerms.includes(term)) {
        matchedTerms.push(term);
      }
    }
    
    // Check kind match
    if (nip.kind !== undefined && nip.kind.toString() === term) {
      score += 4;
      if (!matchedTerms.includes(term)) {
        matchedTerms.push(term);
      }
    }
    
    // Check tag matches
    if (nip.tags && nip.tags.some(tag => tag.toLowerCase() === term)) {
      score += 3;
      if (!matchedTerms.includes(term)) {
        matchedTerms.push(term);
      }
    }
    
    // Partial matches in title (very important)
    if (nip.title.toLowerCase().includes(term)) {
      score += 2;
      if (!matchedTerms.includes(term)) {
        matchedTerms.push(term);
      }
    }
  }
  
  return { score, matchedTerms };
}

// Improved search function
export async function searchNips(query: string, limit: number = 10): Promise<NipSearchResult[]> {
  // Ensure we have NIPs data and the search index is built
  const nips = await getNips();
  
  if (nips.length === 0) {
    console.error("No NIPs available for search");
    return [];
  }
  
  // Handle direct NIP number search as a special case
  const nipNumberMatch = query.match(/^(?:NIP-?)?(\d+)$/i);
  if (nipNumberMatch) {
    const nipNumber = parseInt(nipNumberMatch[1], 10);
    const directNip = nips.find(nip => nip.number === nipNumber);
    
    if (directNip) {
      return [{
        nip: directNip,
        relevance: 100,
        matchedTerms: [nipNumber.toString()]
      }];
    }
  }
  
  // Split query into terms and filter out empty strings
  const searchTerms = query.split(/\s+/).filter(term => term.length > 0);
  
  // Search through all NIPs
  const results: NipSearchResult[] = nips.map(nip => {
    const { score, matchedTerms } = calculateRelevance(nip, searchTerms);
    return {
      nip,
      relevance: score,
      matchedTerms
    };
  })
  // Filter out results with no matches
  .filter(result => result.relevance > 0)
  // Sort by relevance (highest first)
  .sort((a, b) => b.relevance - a.relevance)
  // Limit results
  .slice(0, limit);
  
  return results;
}

// Improved function to get a specific NIP by number
export async function getNipByNumber(number: string | number): Promise<NipData | undefined> {
  const nips = await getNips();
  const nipNumber = typeof number === 'string' ? parseInt(number, 10) : number;
  return nips.find(nip => nip.number === nipNumber);
}

// Improved function to get NIPs by kind
export async function getNipsByKind(kind: number): Promise<NipData[]> {
  const nips = await getNips();
  return nips.filter(nip => nip.kind === kind);
}

// Improved function to get NIPs by status
export async function getNipsByStatus(status: "draft" | "final" | "deprecated"): Promise<NipData[]> {
  const nips = await getNips();
  return nips.filter(nip => nip.status === status);
}

// Force a refresh of the NIPs cache
export async function refreshNipsCache(): Promise<boolean> {
  try {
    await getNips(true);
    return true;
  } catch (error) {
    console.error("Error refreshing NIPs cache:", error);
    return false;
  }
}

// Export schema for the search tool
export const searchNipsSchema = z.object({
  query: z.string().describe("Search query to find relevant NIPs"),
  limit: z.number().min(1).max(50).default(10).describe("Maximum number of results to return"),
  includeContent: z.boolean().default(false).describe("Whether to include the full content of each NIP in the results"),
});

// Format a NIP search result with cleaner output
export function formatNipResult(result: NipSearchResult, includeContent: boolean = false): string {
  const { nip, relevance, matchedTerms } = result;
  
  const lines = [
    `NIP-${nip.number}: ${nip.title}`,
    `Status: ${nip.status}`,
    nip.kind ? `Kind: ${nip.kind}` : null,
    `Description: ${nip.description}`,
    `Relevance Score: ${relevance}`,
    matchedTerms.length > 0 ? `Matched Terms: ${matchedTerms.join(", ")}` : null,
  ].filter(Boolean);
  
  if (includeContent) {
    lines.push("", "Content:", nip.content);
  }
  
  lines.push("---");
  
  return lines.join("\n");
}

// Initialize by loading cache on module import
(async () => {
  // Try to load from disk first
  if (!loadCacheFromDisk()) {
    // If disk cache not available or expired, fetch in background
    console.log('Fetching NIPs in background...');
    getNips().catch(error => {
      console.error('Error initializing NIPs cache:', error);
    });
  }
})(); 