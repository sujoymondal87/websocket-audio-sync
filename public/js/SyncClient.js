// SyncClient — WebSocket connection + clock offset estimation + command scheduling

class SyncClient {
  constructor({ url, onMessage, onOpen, onClose }) {
    this.url = url;
    this.onMessage = onMessage;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.ws = null;
    this.clientId = null;
    this.roomId = null;
    this.role = null;
    this.clockOffset = 0; // serverTime - clientTime
    this.pingInterval = null;
    this.reconnectTimeout = null;
    this.connected = false;
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.connected = true;
      this._startPing();
      if (this.onOpen) this.onOpen();
    };

    this.ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === 'pong') {
        const rtt = Date.now() - msg.clientTime;
        this.clockOffset = msg.serverTime - msg.clientTime - rtt / 2;
        return;
      }

      if (msg.type === 'welcome') {
        this.clientId = msg.clientId;
      }

      if (this.onMessage) this.onMessage(msg);
    };

    this.ws.onclose = () => {
      this.connected = false;
      this._stopPing();
      if (this.onClose) this.onClose();
      // Auto-reconnect after 3s
      this.reconnectTimeout = setTimeout(() => this.connect(), 3000);
    };

    this.ws.onerror = () => {
      this.ws.close();
    };
  }

  send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  joinRoom(roomId, role) {
    this.roomId = roomId;
    this.role = role;
    this.send({ type: 'join_room', roomId, role, clientId: this.clientId });
  }

  sendAudioCommand(command, blockId, positionSec, playbackRate = 1.0) {
    this.send({
      type: 'audio_command',
      roomId: this.roomId,
      command,
      blockId,
      positionSec,
      playbackRate,
      executeAtServerMs: 0, // server will set this
    });
  }

  sendSceneChange(blockId) {
    this.send({
      type: 'scene_change',
      roomId: this.roomId,
      blockId,
      executeAtServerMs: 0,
    });
  }

  // Schedule a callback to fire at server time executeAtServerMs
  scheduleAt(executeAtServerMs, callback) {
    const localExecuteAt = executeAtServerMs - this.clockOffset;
    const delay = Math.max(0, localExecuteAt - Date.now());
    setTimeout(callback, delay);
    return delay;
  }

  serverNow() {
    return Date.now() + this.clockOffset;
  }

  _startPing() {
    this._stopPing();
    this.pingInterval = setInterval(() => {
      this.send({ type: 'ping', clientTime: Date.now() });
    }, 3000);
    // Immediate first ping
    this.send({ type: 'ping', clientTime: Date.now() });
  }

  _stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  disconnect() {
    this._stopPing();
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.ws) this.ws.close();
  }
}
