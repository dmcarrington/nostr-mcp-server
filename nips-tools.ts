import { z } from "zod";
import fetch from "node-fetch";

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
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes instead of 1 hour
let nipsCache: NipData[] = [];
let lastFetchTime = 0;

interface GitHubFile {
  name: string;
  download_url: string;
}

// Function to fetch NIPs from GitHub
async function fetchNipsFromGitHub(): Promise<NipData[]> {
  try {
    // Fetch the NIPs directory listing
    const response = await fetch('https://api.github.com/repos/nostr-protocol/nips/contents');
    if (!response.ok) throw new Error(`GitHub API error: ${response.statusText}`);
    
    const files = await response.json() as GitHubFile[];
    
    // Filter for NIP markdown files and fetch them in parallel
    const nipFiles = files.filter((file: GitHubFile) => 
      file.name.match(/^\d+\.md$/) || 
      file.name.match(/^[0-9A-Fa-f]+\.md$/)
    );
    
    // Fetch all files in parallel
    const nipPromises = nipFiles.map(async (file) => {
      try {
        const contentResponse = await fetch(file.download_url);
        if (!contentResponse.ok) return null;
        
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
        
        const nip: NipData = {
          number,
          title,
          description,
          status,
          kind,
          tags: tags.length > 0 ? tags : undefined,
          content
        };
        
        return nip;
      } catch (error) {
        console.error(`Error fetching NIP ${file.name}:`, error);
        return null;
      }
    });
    
    // Wait for all fetches to complete and filter out nulls
    const results = await Promise.all(nipPromises);
    const nips = results.filter((nip): nip is NipData => nip !== null);
    return nips;
    
  } catch (error) {
    console.error("Error fetching NIPs from GitHub:", error);
    return [];
  }
}

// Function to get NIPs with caching
async function getNips(): Promise<NipData[]> {
  const now = Date.now();
  
  // Return cached data if it's still fresh
  if (nipsCache.length > 0 && now - lastFetchTime < CACHE_TTL) {
    return nipsCache;
  }
  
  // Fetch fresh data
  const nips = await fetchNipsFromGitHub();
  
  // Update cache
  nipsCache = nips;
  lastFetchTime = now;
  
  return nips;
}

// Helper function to calculate relevance score for a search term
function calculateRelevance(nip: NipData, searchTerms: string[]): { score: number; matchedTerms: string[] } {
  const matchedTerms: string[] = [];
  let score = 0;
  
  // Convert search terms to lowercase for case-insensitive matching
  const lowerSearchTerms = searchTerms.map(term => term.toLowerCase());
  
  // Check title matches (highest weight)
  const lowerTitle = nip.title.toLowerCase();
  for (const term of lowerSearchTerms) {
    if (lowerTitle.includes(term)) {
      score += 3;
      matchedTerms.push(term);
    }
  }
  
  // Check description matches (medium weight)
  const lowerDesc = nip.description.toLowerCase();
  for (const term of lowerSearchTerms) {
    if (lowerDesc.includes(term)) {
      score += 2;
      if (!matchedTerms.includes(term)) {
        matchedTerms.push(term);
      }
    }
  }
  
  // Check content matches (lower weight)
  const lowerContent = nip.content.toLowerCase();
  for (const term of lowerSearchTerms) {
    if (lowerContent.includes(term)) {
      score += 1;
      if (!matchedTerms.includes(term)) {
        matchedTerms.push(term);
      }
    }
  }
  
  // Bonus for exact NIP number match
  if (lowerSearchTerms.includes(nip.number.toString().toLowerCase())) {
    score += 5;
    matchedTerms.push(nip.number.toString());
  }
  
  // Bonus for kind match if specified
  if (nip.kind && lowerSearchTerms.includes(nip.kind.toString().toLowerCase())) {
    score += 4;
    matchedTerms.push(nip.kind.toString());
  }
  
  return { score, matchedTerms };
}

// Main search function
export async function searchNips(query: string, limit: number = 10): Promise<NipSearchResult[]> {
  // Get fresh NIPs data
  const nips = await getNips();
  
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

// Function to get a specific NIP by number
export async function getNipByNumber(number: string | number): Promise<NipData | undefined> {
  const nips = await getNips();
  return nips.find(nip => nip.number.toString() === number.toString());
}

// Function to get NIPs by kind
export async function getNipsByKind(kind: number): Promise<NipData[]> {
  const nips = await getNips();
  return nips.filter(nip => nip.kind === kind);
}

// Function to get NIPs by status
export async function getNipsByStatus(status: "draft" | "final" | "deprecated"): Promise<NipData[]> {
  const nips = await getNips();
  return nips.filter(nip => nip.status === status);
}

// Export schema for the search tool
export const searchNipsSchema = z.object({
  query: z.string().describe("Search query to find relevant NIPs"),
  limit: z.number().min(1).max(50).default(10).describe("Maximum number of results to return"),
  includeContent: z.boolean().default(false).describe("Whether to include the full content of each NIP in the results"),
});

// Format a NIP search result
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