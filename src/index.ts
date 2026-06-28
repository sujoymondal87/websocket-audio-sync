import express from 'express';
import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import path from 'path';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { RoomManager } from './room/RoomManager';
import { MSG, JoinRoomMessage, PingMessage, AudioCommandMessage, SceneChangeMessage } from './protocol/types';

dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const rooms = new RoomManager();

const PORT = process.env.PORT || 3001;

// Serve static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Track client → clientId mapping
const clientIds = new Map<WebSocket, string>();

wss.on('connection', (ws: WebSocket) => {
  const clientId = uuidv4();
  clientIds.set(ws, clientId);

  ws.send(JSON.stringify({
    type: MSG.WELCOME,
    clientId,
    serverTime: Date.now(),
  }));

  ws.on('message', (raw: Buffer) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: MSG.ERROR, message: 'Invalid JSON' }));
      return;
    }

    const clientId = clientIds.get(ws)!;

    switch (msg.type) {

      case MSG.JOIN_ROOM: {
        const { roomId, role } = msg as JoinRoomMessage;
        if (!roomId || !role) {
          ws.send(JSON.stringify({ type: MSG.ERROR, message: 'roomId and role required' }));
          return;
        }

        const result = rooms.joinRoom(roomId, clientId, role, ws);
        if (!result.success) {
          ws.send(JSON.stringify({ type: MSG.ERROR, message: result.error }));
          return;
        }

        const state = rooms.getRoomState(roomId)!;
        ws.send(JSON.stringify({
          type: MSG.ROOM_JOINED,
          clientId,
          roomId,
          role,
          serverTime: Date.now(),
          roomState: state,
        }));

        // Notify all members of updated count
        rooms.broadcastToRoom(roomId, {
          type: MSG.MEMBER_UPDATE,
          roomState: state,
          serverTime: Date.now(),
        });
        break;
      }

      case MSG.PING: {
        const { clientTime } = msg as PingMessage;
        ws.send(JSON.stringify({
          type: MSG.PONG,
          clientTime,
          serverTime: Date.now(),
        }));
        break;
      }

      case MSG.AUDIO_COMMAND: {
        const cmd = msg as AudioCommandMessage;
        const room = rooms.getRoomByClient(clientId);
        if (!room) return;

        const role = rooms.getMemberRole(room.id, clientId);
        if (role !== 'leader') {
          ws.send(JSON.stringify({ type: MSG.ERROR, message: 'Only leader can send audio commands' }));
          return;
        }

        const seq = rooms.nextSeq(room.id);
        const executeAtServerMs = Date.now() + 200; // 200ms buffer for followers to prepare

        const relay = {
          ...cmd,
          type: MSG.RELAY,
          originalType: MSG.AUDIO_COMMAND,
          seq,
          executeAtServerMs,
          serverTime: Date.now(),
        };

        rooms.setRoomState(room.id, cmd.blockId, { ...cmd, seq, executeAtServerMs });
        rooms.broadcastToRoom(room.id, relay); // include leader for ack
        break;
      }

      case MSG.SCENE_CHANGE: {
        const cmd = msg as SceneChangeMessage;
        const room = rooms.getRoomByClient(clientId);
        if (!room) return;

        const role = rooms.getMemberRole(room.id, clientId);
        if (role !== 'leader') return;

        const seq = rooms.nextSeq(room.id);
        const executeAtServerMs = Date.now() + 150;

        const relay = {
          ...cmd,
          type: MSG.RELAY,
          originalType: MSG.SCENE_CHANGE,
          seq,
          executeAtServerMs,
          serverTime: Date.now(),
        };

        rooms.setRoomState(room.id, cmd.blockId, null);
        rooms.broadcastToRoom(room.id, relay);
        break;
      }

      default:
        ws.send(JSON.stringify({ type: MSG.ERROR, message: `Unknown message type: ${msg.type}` }));
    }
  });

  ws.on('close', () => {
    const clientId = clientIds.get(ws);
    if (clientId) {
      const room = rooms.getRoomByClient(clientId);
      if (room) {
        rooms.leaveAllRooms(clientId);
        const state = rooms.getRoomState(room.id);
        if (state) {
          rooms.broadcastToRoom(room.id, {
            type: MSG.MEMBER_UPDATE,
            roomState: state,
            serverTime: Date.now(),
          });
        }
      }
      clientIds.delete(ws);
    }
  });

  ws.on('error', (err) => {
    console.error('WS error:', err.message);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  wss.close();
  server.close();
});
