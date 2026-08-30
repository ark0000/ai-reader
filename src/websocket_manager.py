from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, List
import json
import logging

logger = logging.getLogger(__name__)

class ConnectionManager:
    """
    Singleton pattern Connection Manager to handle remote stylus WebSocket connections.
    Organizes connections by room_id so multiple users/devices can collaborate.
    """
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ConnectionManager, cls).__new__(cls)
            cls._instance.active_connections = {}  # Dict[str, List[WebSocket]]
        return cls._instance

    def __init__(self):
        if not hasattr(self, 'active_connections'):
            self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, room_id: str, websocket: WebSocket):
        await websocket.accept()
        if room_id not in self.active_connections:
            self.active_connections[room_id] = []
        self.active_connections[room_id].append(websocket)
        logger.info(f"WebSocket connected to room {room_id}. Total in room: {len(self.active_connections[room_id])}")

    def disconnect(self, room_id: str, websocket: WebSocket):
        if room_id in self.active_connections:
            if websocket in self.active_connections[room_id]:
                self.active_connections[room_id].remove(websocket)
            if len(self.active_connections[room_id]) == 0:
                del self.active_connections[room_id]
        logger.info(f"WebSocket disconnected from room {room_id}.")

    async def broadcast(self, room_id: str, message: dict, exclude_sender: WebSocket = None):
        """
        Broadcast a message to all connected clients in a specific room.
        Optionally exclude the sender to avoid echo.
        """
        if room_id in self.active_connections:
            dead_connections = []
            payload = json.dumps(message)
            for connection in self.active_connections[room_id]:
                if connection == exclude_sender:
                    continue
                try:
                    await connection.send_text(payload)
                except Exception as e:
                    logger.error(f"Error broadcasting to connection in room {room_id}: {e}")
                    dead_connections.append(connection)
            
            # Clean up dead connections
            for dead in dead_connections:
                self.disconnect(room_id, dead)

manager = ConnectionManager()
