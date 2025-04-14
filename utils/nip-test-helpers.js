// Helper functions that extract the NIP search handler logic for testing

import {
  searchNips,
  formatNipResult
} from '../nips/nips-tools.js';

// Extracted handler for searchNips tool
export const searchNipsHandler = async ({ query, limit, includeContent }) => {
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
    
    // Format results
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
};

// Default export for the module
export default {
  searchNipsHandler
}; 