import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { eventBus, EVENTS } from './eventBus';
import { envConfig } from './config/env';

export function setupWebSocket(server: HttpServer) {
    const io = new SocketIOServer(server, {
        cors: {
            origin: envConfig.CLIENT_ORIGIN,
            methods: ['GET', 'POST'],
            credentials: true
        }
    });

    io.on('connection', (socket) => {
        console.log(`[WebSocket] Client connected: ${socket.id}`);

        // Client can subscribe to specific asset streams or global market updates
        socket.on('subscribe:asset', (assetId: number) => {
            socket.join(`asset:${assetId}`);
            console.log(`[WebSocket] ${socket.id} subscribed to asset:${assetId}`);
        });

        socket.on('unsubscribe:asset', (assetId: number) => {
            socket.leave(`asset:${assetId}`);
        });

        socket.on('subscribe:market', () => {
            socket.join('market:global');
            console.log(`[WebSocket] ${socket.id} subscribed to market:global`);
        });

        socket.on('subscribe:files', (groupId: string) => {
            socket.join(`files:${groupId}`);
            console.log(`[WebSocket] ${socket.id} subscribed to files:${groupId}`);
        });

        socket.on('unsubscribe:files', (groupId: string) => {
            socket.leave(`files:${groupId}`);
        });

        socket.on('disconnect', () => {
            console.log(`[WebSocket] Client disconnected: ${socket.id}`);
        });
    });

    // Listen to internal worker events and relay to relevant socket rooms
    eventBus.on(EVENTS.METRICS_INGESTED, (payload: { assetId: number; metrics: any[] }) => {
        // Broadcast to anyone listening to this asset
        io.to(`asset:${payload.assetId}`).emit('live_metrics', payload.metrics);
    });

    eventBus.on(EVENTS.MARKET_INGESTED, (metrics: any[]) => {
        // Broadcast to market listeners
        io.to('market:global').emit('live_market', metrics);
    });

    eventBus.on(EVENTS.FILE_UPDATED, (payload: { groupId: string; sourceKey: string; versionId: number; versionNo: number }) => {
        io.to(`files:${payload.groupId}`).emit('file:updated', payload);
    });

    eventBus.on(EVENTS.BACKFILL_COMPLETE, (payload: { assetId: number; gcpId: string; companyId: number; dateKey: string }) => {
        io.to(`asset:${payload.assetId}`).emit('backfill_complete', payload);
    });

    return io;
}
