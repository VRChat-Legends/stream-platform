# Streaming chat and Discord

The streaming platform and Mochi have separate applications, databases, sessions and containers. The streaming bot reports streaming activity only. Guest invitations, keys, browser broadcasting, playback and the guest database have been removed.

## Live chat

Sign in with VRChat Legends on the watch page to post. Public messages appear in the viewer and OBS overlay. Messages are limited to 500 characters, one every two seconds and 12 per minute. History retains at most 1,000 messages for seven days; viewers receive the latest 100. Studio → Chat can remove messages, mute/unmute accounts and clear history.

- OBS Browser Source: https://watch.vrchatlegends.com/chat/overlay
- Pop-out: https://watch.vrchatlegends.com/chat
- SSE: https://watch.vrchatlegends.com/api/chat/events
- JSON history: https://watch.vrchatlegends.com/api/chat/messages

Use a 420 × 800 Browser Source for the transparent overlay. SSE events are `snapshot` (array), `message` (object) and `delete` (`{id}`). Each message has id, public userId, name, body and time. Removing a message updates connected overlays.

## Playback formats

- HLS: https://stream.vrchatlegends.com/live.m3u8
- Live fragmented MP4: https://stream.vrchatlegends.com/live.mp4
- Continuous MPEG-TS: https://stream.vrchatlegends.com/live.ts

MP4 is a continuous fragmented stream, not a seekable recording. Some players require HLS instead. The server remuxes H.264/AAC without another video encode. MPEG-TS clients share a relay; each MP4 connection starts with its own initialization data. Slow clients are disconnected and there is a combined 40-client direct-stream cap; use HLS for larger audiences. No recording is retained by these URLs.

## OAuth

Configure OAuth credentials in your local `.env`. Register the streaming redirect:

- Streaming chat: `https://watch.vrchatlegends.com/auth/callback`

The application uses `https://api.vrchatlegends.com/api/oauth2/` directly, with the `identify` scope, random cookie-bound state, PKCE S256 and a confidential server-side token exchange. Provider access tokens are used to fetch identity and are not sent to the frontend or stored. It issues its own host-only Secure/HttpOnly session cookie and CSRF token. Studio admin authentication remains separate.

## Discord

The bot connects to the Discord gateway and registers `/streamstatus`. Studio → Integrations shows its connection status and lets the administrator select a server and text channel. The selected channel receives publisher/fallback events and a summary every ten minutes: live/fallback status, HLS viewer sessions, chat counts and program health. Private keys, chat content and AI activity are excluded.

The bot token remains server-side. The selected channel is preserved in the streaming database. The bot needs permission to view the channel, send messages and embed links.
