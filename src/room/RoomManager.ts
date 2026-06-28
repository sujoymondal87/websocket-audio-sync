import WebSocket from 'ws';
import { Role, AudioCommandMessage, RoomState } from '../protocol/types';

interface RoomMember {
  ws: WebSocket;
  clientId: string;
  role: Role;
  joinedAt: number;
}

interface Room {
  id: string;
  members: Map<string, RoomMember>;
  seq: number;
  currentBlockId: string | null;
  lastCommand: AudioCommandMessage | null;
  createdAt: number;
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();

  createOrGetRoom(roomId: string): Room {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, {
        id: roomId,
        members: new Map(),
        seq: 0,
        currentBlockId: null,
        lastCommand: null,
        createdAt: Date.now(),
      });
    }
    return this.rooms.get(roomId)!;
  }

  joinRoom(roomId: string, clientId: string, role: Role, ws: WebSocket): { success: boolean; error?: string } {
    const room = this.createOrGetRoom(roomId);

    // Only one leader per room
    if (role === 'leader') {
      const existingLeader = Array.from(room.members.values()).find(m => m.role === 'leader');
      if (existingLeader && existingLeader.clientId !== clientId) {
        return { success: false, error: 'Room already has a leader' };
      }
    }

    room.members.set(clientId, { ws, clientId, role, joinedAt: Date.now() });
    return { success: true };
  }

  leaveRoom(roomId: string, clientId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.members.delete(clientId);
    if (room.members.size === 0) {
      this.rooms.delete(roomId);
    }
  }

  leaveAllRooms(clientId: string): void {
    for (const [roomId, room] of this.rooms.entries()) {
      room.members.delete(clientId);
      if (room.members.size === 0) {
        this.rooms.delete(roomId);
      }
    }
  }

  getRoomByClient(clientId: string): Room | null {
    for (const room of this.rooms.values()) {
      if (room.members.has(clientId)) return room;
    }
    return null;
  }

  nextSeq(roomId: string): number {
    const room = this.rooms.get(roomId);
    if (!room) return 0;
    room.seq++;
    return room.seq;
  }

  setRoomState(roomId: string, blockId: string, lastCommand: AudioCommandMessage | null): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.currentBlockId = blockId;
    room.lastCommand = lastCommand;
  }

  getRoomState(roomId: string): RoomState | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const followers = Array.from(room.members.values()).filter(m => m.role === 'follower');
    return {
      roomId,
      memberCount: room.members.size,
      followerCount: followers.length,
      currentBlockId: room.currentBlockId,
      lastCommand: room.lastCommand,
      seq: room.seq,
    };
  }

  broadcastToRoom(roomId: string, payload: object, excludeClientId?: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const data = JSON.stringify(payload);
    for (const member of room.members.values()) {
      if (member.clientId === excludeClientId) continue;
      if (member.ws.readyState === WebSocket.OPEN) {
        member.ws.send(data);
      }
    }
  }

  sendToClient(roomId: string, clientId: string, payload: object): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const member = room.members.get(clientId);
    if (member && member.ws.readyState === WebSocket.OPEN) {
      member.ws.send(JSON.stringify(payload));
    }
  }

  getMemberRole(roomId: string, clientId: string): Role | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return room.members.get(clientId)?.role || null;
  }
}
