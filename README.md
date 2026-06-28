# websocket-audio-sync

> Real-time multi-device audio guide synchronisation over WebSocket — leader controls playback, followers receive timestamped commands and play in sync with sub-200ms alignment.

**Live Demo:** [coming soon]
**Case Study:** [coming soon]

## What it demonstrates

- Room-based WebSocket architecture (leader/follower roles, 4-digit room code)
- Timestamped `audio_command` protocol (play, pause, seek, scene_change)
- Clock offset estimation via ping/pong — followers schedule playback at `executeAtServerMs`
- Instant scene sync — tap a stop on leader, all followers jump to the same stop
- Real-time event log with sequence numbers and latency readout
- Vanilla JS frontend served by Express — no build step, no framework

## Architecture

```
Leader browser                 WebSocket Server (Render)         Follower browsers
──────────────                 ─────────────────────────         ─────────────────
Tab click → scene_change  →   relay to room members        →    scheduleAt(executeAtServerMs)
Play/pause/seek           →   audio_command relay           →    apply at T+delay
                               ping/pong clock sync
                               RoomManager (in-memory)
                               seq numbers (stale drop)
```

## Stack

| Layer | Technology |
|---|---|
| Server | Node.js + Express + TypeScript |
| WebSocket | `ws` library |
| Frontend | Vanilla JS + CSS (served by Express) |
| Deploy | Render |
| DB | None — room state is in-memory |

## Quick start

```bash
cp .env.example .env
npm install
npm run dev
# open http://localhost:3001
# open two tabs — one as leader, one as follower
```

## Protocol

All messages are JSON with a `type` field.

### Client → Server

| type | purpose | key fields |
|---|---|---|
| `join_room` | Enter a room | `roomId`, `role` |
| `ping` | Clock sync | `clientTime` |
| `audio_command` | Play/pause/seek/stop | `command`, `blockId`, `positionSec` |
| `scene_change` | Jump to a stop | `blockId` |

### Server → Client

| type | purpose |
|---|---|
| `welcome` | Connection ack + `clientId` |
| `room_joined` | Role confirmed + current room state |
| `pong` | Clock sync reply (`clientTime`, `serverTime`) |
| `relay` | Forwarded command from leader |
| `member_update` | Follower count changed |
| `error` | Validation failure |

## Environment variables

| Key | Default | Description |
|---|---|---|
| `PORT` | 3001 | Server port |
| `NODE_ENV` | development | |
| `NODE_VERSION` | 22.11.0 | Set on Render |

## Deployment (Render)

- Root directory: `.` (repo root)
- Build command: `npm install && npm run build`
- Start command: `npm start`
- Env vars: `NODE_VERSION=22.11.0`, `NPM_CONFIG_PRODUCTION=false`, `PORT=3001`

## Production context

Derived from the WebSocket broadcast layer (`npserver/websoc/server.js`) in the Neareo/MyAppZone production platform. The production system coordinates audio playback across kiosk and visitor devices in cultural institution deployments across Spain, France, and Belgium.
