import * as http from "http";
import EventEmitter = require("eventemitter3");
import WebSocket = require("ws");
import { Server as WebSocketServer, ServerOptions as WSServerOptions, OPEN as WS_OPEN } from "ws";
import uuidv4 = require("uuid/v4");
import { Notification, Request, Response, createError } from "./common";

type SocketId = string;
type MethodFunction = (socket: Socket, params: any) => Promise<any> | any;

export enum VERSION_CHECK_MODE {
    STRICT,
    LOOSE,
    IGNORE
}

export interface Options {
    /**
     * call `#open()`
     */
    open?: boolean;
    /**
     * `STRICT`: only accepts jsonrpc: `2.0`.
     * `LOOSE`: accepts jsonrpc: `2.0` but it's omittable.
     * `IGNORE`: ignore jsonrpc property.
     */
    jsonrpcVersionCheck?: VERSION_CHECK_MODE;
    /**
     * `ws` constructor's options.
     *  details: https://github.com/websockets/ws/blob/master/doc/ws.md
     */
    wss: WSServerOptions;
}

export default interface Server {
    on(event: "listening", cb: (this: Server) => void): this;
    on(event: "connection", cb: (this: Server, socket: Socket, req?: http.IncomingMessage) => void): this;
    on(event: "error", cb: (this: Server, error: Error) => void): this;
}

export interface Socket {
    on(event: "close", cb: (this: Socket) => void): this;
}

/**
 * JSON-RPC 2.0 WebSocket Server
 */
export default class Server extends EventEmitter {

    options: Options;
    wss: WebSocketServer;
    sockets: Map<SocketId, Socket> = new Map();
    methods: Map<string, MethodFunction> = new Map();

    /**
     * Create a instance.
     * @param options
     * @param callback callback A listener for the `listening` event (ws).
     */
    constructor(options: Options, callback?: () => void) {
        super();

        this.options = Object.assign({
            open: true,
            jsonrpcVersionCheck: VERSION_CHECK_MODE.STRICT
        }, options);

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

        this.wss = new WebSocketServer(this.options.wss, callback);

        this.wss.once("listening", () => this.emit("listening"));

        this.wss.on("connection", (ws, req) => {

            const socket = new Socket(this, ws, req);

            this.sockets.set(socket.id, socket);

            ws.once("close", () => {
                this.sockets.delete(socket.id);
                socket.emit("close");
                socket.removeAllListeners();
                ws.removeAllListeners();
            });

            ws.on("message", data => this._wsMessageHandler(socket, data));

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

    private async _wsMessageHandler(socket: Socket, data: WebSocket.Data): Promise<void> {

        const calls: (Request | Notification)[] = [];
        const responses: Response[] = [];

        let isBinary = false;
        let isArray = false;

        if (data instanceof ArrayBuffer) {
            isBinary = true;

            data = Buffer.from(data).toString();
        }

        try {
            const obj = JSON.parse(<string> data);
            if (Array.isArray(obj)) {
                isArray = true;

                if (obj.length === 0) {
                    const res: Response = {
                        jsonrpc: "2.0",
                        error: createError(-32600, null, "Empty Array"),
                        id: null
                    };
                    socket.send(JSON.stringify(res), isBinary);
                    return;
                }

                calls.push(...obj);
            } else {
                calls.push(obj);
            }
        } catch (e) {
            const res: Response = {
                jsonrpc: "2.0",
                error: createError(-32700, null, "Invalid JSON"),
                id: null
            };
            socket.send(JSON.stringify(res), isBinary);
            return;
        }

        for (const call of calls) {
            const res = await this._processCall(socket, call);
            if (res) {
                responses.push(res);
            }
        }

        if (responses.length === 0) {
            return;
        }

        socket.send(JSON.stringify(isArray ? responses : responses[0]), isBinary);
    }

    private async _processCall(socket: Socket, call: Request | Notification): Promise<Response | void> {

        const reqId = (<Request> call).id;

        const res: Response = {
            jsonrpc: "2.0",
            id: reqId === undefined ? null : reqId
        };

        if (typeof call !== "object") {
            res.error = createError(-32600);
            return res;
        }

        if (
            call.jsonrpc !== "2.0" && (
                this.options.jsonrpcVersionCheck === VERSION_CHECK_MODE.STRICT ||
                (this.options.jsonrpcVersionCheck === VERSION_CHECK_MODE.LOOSE && call.jsonrpc !== undefined)
            )
        ) {
            res.error = createError(-32600, null, "Invalid JSON-RPC Version");
            return res;
        }

        if (!call.method) {
            res.error = createError(-32602, null, "Method not specified");
            return res;
        }

        if (typeof call.method !== "string") {
            res.error = createError(-32600, null, "Invalid type of method name");
            return res;
        }

        if (typeof call.params !== "object" || call.params === null) {
            res.error = createError(-32600);
            return res;
        }

        if (this.methods.has(call.method) === false) {
            res.error = createError(-32601);
            return res;
        }

        try {
            res.result = await this.methods.get(call.method)(socket, call.params) || null;
            if (reqId === undefined) {
                return;
            }
            return res;
        } catch (e) {
            if (reqId === undefined) {
                return;
            }
            if (e instanceof Error) {
                res.error = createError(-32000, e.name, e.message);
            } else {
                res.error = e;
            }
            return res;
        }
    }
}

export class Socket extends EventEmitter {

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
        if (this.ws.readyState === WS_OPEN) {
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
}
