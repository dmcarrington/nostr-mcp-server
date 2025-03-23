# Nostr MCP Server

A Model Context Protocol (MCP) server that provides Nostr capabilities to LLMs like Claude.

## Features

This server implements three tools for interacting with the Nostr network:

1. `getProfile`: Fetches a user's profile information by public key
2. `getKind1Notes`: Fetches text notes (kind 1) authored by a user
3. `getReceivedZaps`: Fetches zaps received by a user

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/nostr-mcp-server.git
cd nostr-mcp-server

# Install dependencies
npm install

# Build the project
npm run build
```

## Connecting to Claude for Desktop

1. Make sure you have [Claude for Desktop](https://claude.ai/desktop) installed and updated to the latest version.

2. Configure Claude for Desktop by editing or creating the configuration file:

   For macOS:
   ```bash
   vim ~/Library/Application\ Support/Claude/claude_desktop_config.json
   ```

   For Windows:
   ```bash
   notepad %AppData%\Claude\claude_desktop_config.json
   ```

3. Add the Nostr server to your configuration:

   ```json
   {
       "mcpServers": {
           "nostr": {
               "command": "node",
               "args": [
                   "/ABSOLUTE/PATH/TO/nostr-mcp-server/build/index.js"
               ]
           }
       }
   }
   ```

   Be sure to replace `/ABSOLUTE/PATH/TO/` with the actual path to your project.

4. Restart Claude for Desktop.

## Usage in Claude

Once configured, you can ask Claude to use the Nostr tools by making requests like:

- "Show me the profile information for npub1qny3tkh0acurzla8x3zy4nhrjz5zd8ne6dvrjehx9n9hr3lnj08qwuzwc8"
- "What are the recent posts from npub1qny3tkh0acurzla8x3zy4nhrjz5zd8ne6dvrjehx9n9hr3lnj08qwuzwc8?"
- "How many zaps has npub1qny3tkh0acurzla8x3zy4nhrjz5zd8ne6dvrjehx9n9hr3lnj08qwuzwc8 received?"

Claude will convert npub addresses to hex public keys automatically.

## Advanced Usage

You can specify custom relays for any query:

- "Show me the profile for npub1qny3tkh0acurzla8x3zy4nhrjz5zd8ne6dvrjehx9n9hr3lnj08qwuzwc8 using relay wss://relay.damus.io"

You can also specify the number of notes or zaps to fetch:

- "Show me the latest 20 notes from npub1qny3tkh0acurzla8x3zy4nhrjz5zd8ne6dvrjehx9n9hr3lnj08qwuzwc8"

## Limitations

- The server has a default 8-second timeout for queries to prevent hanging
- Only public keys in hex format are supported in the API (though Claude can convert npubs)
- Only a subset of relays is used by default

## Implementation Details

- Each tool call creates a fresh connection to the relays, ensuring reliable data retrieval
- The server automatically closes connections after each query is completed
- Connections are properly managed to prevent memory leaks

## Troubleshooting

- If queries time out, try increasing the `QUERY_TIMEOUT` value in the source code (currently 8 seconds)
- If no data is found, try specifying different relays that might have the data
- Check Claude's MCP logs for detailed error information

## Default Relays

The server uses the following relays by default:
- wss://relay.damus.io
- wss://relay.nostr.band
- wss://nos.lol
- wss://relay.current.fyi
- wss://nostr.bitcoiner.social

## Development

To modify or extend this server:

1. Edit the `src/index.ts` file
2. Run `npm run build` to compile
3. Restart Claude for Desktop to pick up your changes 