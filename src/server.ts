import * as http from "http";
import EventEmitter = require("eventemitter3");
import WebSocket = require("ws");
import { Server as WebSocketServer, ServerOptions as WSServerOptions, OPEN as WS_OPEN } from "ws";
import uuidv4 = require("uuid/v4");
import { Notification, Error as RPCError, Response, ErrorResponse } from "./common";
import { Socket as ISocket } from "./Socket";
import MessageHandler, { VERSION_CHECK_MODE, Options as MessageHandlerOptions } from "./MessageHandler";

type SocketId = string;

export interface Options extends MessageHandlerOptions {
    /**
     * call `#open()`
     */
    open?: boolean;
    /**
     * `ws` constructor's options.
     *  details: https://github.com/websockets/ws/blob/master/doc/ws.md
     */
    wss: WSServerOptions;
    /**
     * use `uws` (experimental)
     */
    uws?: boolean;
}

export default interface Server {
    on(event: "listening", cb: (this: Server) => void): this;
    on(event: "connection", cb: (this: Server, socket: Socket, req?: http.IncomingMessage) => void): this;
    on(event: "error", cb: (this: Server, error: Error) => void): this;
    on(event: "error_response", cb: (this: Server, response: ErrorResponse) => void): this;
    on(event: "notification_error", cb: (this: Server, error: RPCError) => void): this;
}

/**
 * JSON-RPC 2.0 WebSocket Server
 */
export default class Server extends EventEmitter {

    options: Options;
    wss: WebSocketServer;
    sockets: Map<SocketId, Socket> = new Map();
    get methods() { return this._messageHandler.methods; }

    private _messageHandler: MessageHandler<Socket>;

    /**
     * Create a instance.
     * @param options
     * @param callback callback A listener for the `listening` event (ws).
     */
    constructor(options: Options, callback?: () => void) {
        super();

        this.options = Object.assign({
            open: true,
            jsonrpcVersionCheck: VERSION_CHECK_MODE.STRICT,
            uws: false
        }, options);

        this._messageHandler = new MessageHandler(this.options);
        this._messageHandler.on("error_response", (socket, response) => {
            this.emit("error_response", socket, response);
            socket.emit("error_response", response);
        });
        this._messageHandler.on("notification_error", (socket, error) => {
            this.emit("notification_error", socket, error);
            socket.emit("notification_error", error);
        });

        if (this.options.open) {
            this.open(callback);
        }
    }

    /**
     * Create
     * @param callback callback A listener for the `listening` event (ws).
     */
    open(callback?: () => void): this {

        if (this.wss) {
            throw new Error("`ws` has already been created");
        }

        if (this.options.uws) {
            this.wss = new (require("uws").Server)(this.options.wss, callback);
        } else {
            this.wss = new WebSocketServer(this.options.wss, callback);
        }

        this.wss.once("listening", () => this.emit("listening"));

        this.wss.on("connection", (ws, req) => {

            let socket = new Socket(this, ws, req);

            this.sockets.set(socket.id, socket);

            ws.once("close", () => {
                this.sockets.delete(socket.id);
                socket.emit("close");
                socket.removeAllListeners();
                socket.ws = null;
                socket = null;
                ws.removeAllListeners();
                ws = null;
            });

            ws.on("message", data => this._messageHandler.handleMessage(socket, data).catch(e => this.emit("error", e)));

            this.emit("connection", socket, req);
        });

        this.wss.on("error", e => this.emit("error", e));

        return this;
    }

    /**
     * Closes the server and terminates all sockets.
     */
    async close(): Promise<void> {

        for (const socket of this.sockets.values()) {
            socket.terminate();
        }

        await new Promise((resolve, reject) => {
            this.wss.close(err => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        this.wss.removeAllListeners();
        delete this.wss;
        this.sockets.clear();
    }

    /**
     * Broadcasts a notification.
     * @param method The name of the method to be invoked.
     * @param params The parameters of the method.
     */
    broadcast(method: string, params?: object): void {

        const data: Notification = {
            jsonrpc: "2.0",
            method: method,
            params: params
        };
        const json = JSON.stringify(data);

        for (const socket of this.sockets.values()) {
            socket.send(json);
        }
    }

    /**
     * Broadcasts a notification to the room.
     * @param room The name of the room.
     * @param method The name of the method to be invoked.
     * @param params The parameters of the method.
     */
    notifyTo(room: string, method: string, params?: object): void {

        const data: Notification = {
            jsonrpc: "2.0",
            method: method,
            params: params
        };
        const json = JSON.stringify(data);

        for (const socket of this.sockets.values()) {
            if (socket.rooms.has(room) === true) {
                socket.send(json);
            }
        }
    }

    /**
     * Get all sockets in the room.
     * @param room The name of the room.
     */
    in(room: string): Map<SocketId, Socket> {

        const sockets: Map<SocketId, Socket> = new Map();

        for (const socket of this.sockets.values()) {
            if (socket.rooms.has(room) === true) {
                sockets.set(socket.id, socket);
            }
        }

        return sockets;
    }

    /**
     * Server is open or not
     */
    isOpen() {
        return this.wss !== undefined;
    }
}

/**
 * Socket of JSON-RPC 2.0 WebSocket Server
 */
export interface Socket extends ISocket {
    on(event: "close", cb: (this: Socket) => void): this;
    on(event: "notification_error", cb: (this: Socket, error: RPCError) => void): void;
    on(event: "error_response", cb: (this: Socket, response: ErrorResponse) => void): void;
}

export class Socket extends EventEmitter implements ISocket {

    readonly id: string = uuidv4();
    readonly rooms: Set<string> = new Set();

    /** custom data store */
    data = new Map();

    constructor(public server: Server, public ws: WebSocket, public req: http.IncomingMessage) {
        super();
    }

    /**
     * Sends a notification to the socket.
     * @param method The name of the method to be invoked.
     * @param params The parameters of the method.
     */
    notify(method: string, params?: any): void {
        const data: Notification = {
            jsonrpc: "2.0",
            method: method,
            params: params
        };
        this.send(JSON.stringify(data));
    }

    /**
     * Sends a (raw) message to the socket.
     * @param method The name of the method to be invoked.
     * @param params The parameters of the method.
     */
    send(data: any, binary: boolean = false): void {
        if (this.isOpen()) {
            this.ws.send(data, { binary });
        }
    }

    /**
     * Joins a room. You can join multiple rooms.
     * @param room The name of the room that we want to join.
     */
    joinTo(room: string): boolean {
        if (this.rooms.has(room) === false) {
            this.rooms.add(room);
            return true;
        }
        return false;
    }

    /**
     * Leaves a room.
     * @param room The name of the room to leave.
     */
    leaveFrom(room: string): boolean {
        if (this.rooms.has(room) === true) {
            this.rooms.delete(room);
            return true;
        }
        return false;
    }

    /**
     * Leaves all the rooms that we've joined.
     */
    leaveFromAll(): void {
        this.rooms.clear();
    }

    /**
     * Initiate a closing handshake.
     * @param code A numeric value indicating the status code explaining why the connection is being closed.
     * @param reason A human-readable string explaining why the connection is closing.
     */
    close(code?: number, reason?: string): void {
        this.ws.close(code, reason);
    }

    /**
     * Forcibly close the connection.
     */
    terminate(): void {
        this.ws.terminate();
    }

    /**
     * Get the connection is open or not
     */
    isOpen() {
        return this.ws !== undefined && this.ws.readyState === WS_OPEN;
    }
}
