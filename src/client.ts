import WebSocket = require("isomorphic-ws");
import Backoff = require("backo2");
import EventEmitter = require("eventemitter3");
import { Socket } from "./Socket";
import { isString } from "util";
import { Data } from "isomorphic-ws";
import { Notification, Request, Response, isSuccessResponse, Error as RPCError, ErrorResponse } from "./common";
import MessageHandler, { Options as MessageHandlerOptions } from "./MessageHandler";

/**
 * Client Config
 */
export interface Config extends MessageHandlerOptions, WebSocket.ClientOptions {
    reconnection: boolean;
    reconnectionAttempts: number;
    reconnectionDelay: number;
    reconnectionDelayMax: number;
    reconnectionJitter: number;
    methodCallTimeout: number;
    autoConnect: boolean;
    query: object;
    protocols: string | string[];
}

/**
 * Client Options
 */
export type Options = Partial<Config>;

export const ConfigDefaults: Config = Object.freeze({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionJitter: 0.5,
    methodCallTimeout: 20000,
    autoConnect: true,
    query: {},
    protocols: ""
});

// Hack typing because attempts property is missing in @types.
type BackoffEx = Backoff & {attempts: number};

export default interface Client {
    on(event: "connecting", listener: (this: Client) => void);
    on(event: "connected", listener: (this: Client) => void);
    on(event: "disconnect", listener: (this: Client, code: number, reason: any) => void);
    on(event: "reconnecting", listener: (this: Client, attemps: number) => void);
    on(event: "reconnect_failed", listener: (this: Client) => void);
    on(event: "reconnect_error", listener: (this: Client, err: any) => void);
    on(event: "reconnected", listener: (this: Client, attemps: number) => void);
    on(event: "error_response", listener: (this: Client, response: ErrorResponse) => void);
    on(event: "notification_error", listener: (this: Client, error: RPCError) => void);
    on(event: "close", cb: (this: Client) => void): this;
    on(event: "error", listener: (this: Client, error: any) => void);
}

/**
 * JSON-RPC 2.0 Client
 */
export default class Client extends EventEmitter implements Socket {
    readonly config: Config;

    get methods() { return this._messageHandler.methods; }

    private _ws: WebSocket;
    private _backoff: BackoffEx;
    private _reconnecting: boolean = false;
    private _messageHandler: MessageHandler<Client>;
    private _responseHandlers: Map<number, [NodeJS.Timer, (value?: any) => void, (reason?: any) => void]> = new Map();
    private _skipReconnection: boolean = false;
    private _currentRequestId: number = 0;
    private _reconnectionSleepTimer: number;

    /**
     * Create an instance
     * @param uri The URI to connect.
     * @param options Options
     */
    constructor(readonly uri: string, options: Options = {}) {
        super();

        this.config = {
            ...ConfigDefaults,
            ...options
        };

        this._backoff = new Backoff({
            min: this.config.reconnectionDelay,
            max: this.config.reconnectionDelayMax,
            jitter: this.config.reconnectionJitter
        }) as BackoffEx;

        this._messageHandler = new MessageHandler(this.config);
        this._messageHandler.on("method_response", (socket, response) => this._handleMethodResponse(response));
        this._messageHandler.on("error_response", (socket, response) => this.emit("error_response", response));
        this._messageHandler.on("notification_error", (socket, error) => this.emit("notification_error", error));

        if (this.config.autoConnect) {
            this.connect();
        }
    }

    /**
     * Connect to the server
     */
    async connect() {
        if (this._ws) {
            return;
        }

        this.emit("connecting");
        const ws = this._ws = new WebSocket(this.uri, this.config.protocols, this.config);
        ws.on("error", error => this.emit("error", error));

        ws.on("close", () => this.emit("close"));
        ws.on("close", (code, reason) => this.emit("disconnect", code, reason));
        ws.on("close", () => this._ws = null);

        if (this.config.reconnection) {
            this._skipReconnection = false;
            ws.on("close", () => this.reconnect());
        }

        ws.on("message", data => this._messageHandler.handleMessage(this, data));

        await new Promise((resolve, reject) => {
            ws.once("open", () => {
                ws.off("error", reject);
                resolve();
            });
            ws.once("error", reject);
        });

        this.emit("connected");
    }

    /**
     * Disconnect the connection if it exists
     */
    disconnect(): Promise<void> {
        this._skipReconnection = true;
        this._reconnecting = false;
        this._backoff.reset();

        // clear method call timeout.
        for (const [timer] of this._responseHandlers) {
            clearTimeout(timer);
        }
        this._responseHandlers.clear();

        // clear reconnection timer.
        if (this._reconnectionSleepTimer) {
            clearTimeout(this._reconnectionSleepTimer);
            this._reconnectionSleepTimer = null;
        }

        const ws = this._ws;
        if (!ws) {
            return Promise.resolve();
        }

        let promise: Promise<void>;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            promise = new Promise(resolve => ws.once("close", () => resolve()));
            ws.close();
        } else {
            promise = Promise.resolve();
        }

        this._ws = null;
        ws.removeAllListeners();

        return promise;
    }

    send(data: Data, binary: boolean = false): void {
        if (this._ws.readyState !== WebSocket.OPEN)  {
            return;
        }

        if (binary && isString(data)) {
            data = Buffer.from(data).buffer as any as ArrayBuffer;
        }

        this._ws.send(data);
    }

    notify(method: string, params?: object) {
        const data: Notification = {
            jsonrpc: "2.0",
            method,
            params
        };
        this.send(JSON.stringify(data));
    }

    call(method: string, params: object = {}): Promise<any> {
        const id = this._currentRequestId++;
        const data: Request = {
            jsonrpc: "2.0",
            method,
            params,
            id
        };
        this.send(JSON.stringify(data));

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this._responseHandlers.delete(id);
                reject(new Error("JSON-RPC: method call timeout"));
            }, this.config.methodCallTimeout);
            this._responseHandlers.set(id, [timeout, resolve, reject]);
        });
    }

    private async reconnect() {
        if (this._reconnecting || this._skipReconnection) {
            return;
        }

        const backoff = this._backoff;

        if (backoff.attempts > this.config.reconnectionAttempts) {
            this.emit("reconnect_failed");
            this.disconnect();
            return;
        }

        const delay = backoff.duration();
        this._reconnecting = true;

        await new Promise(resolve => this._reconnectionSleepTimer = setTimeout(resolve, delay) as any);
        this._reconnectionSleepTimer = null;

        if (this._skipReconnection) {
            return;
        }

        this.emit("reconnecting", backoff.attempts);

        if (this._skipReconnection) {
            return;
        }

        this.connect();

        try {
            await new Promise((resolve, reject) => {
                this._ws.once("close", (code, reason) => reject({code, reason}));
                this._ws.once("open", () => {
                    this._ws.off("close", reject);
                    resolve();
                });
            });

        } catch (err) {
            this._reconnecting = false;
            this.reconnect();
            this.emit("reconnect_error", err);
            return;
        }

        const attempts = backoff.attempts;
        backoff.reset();
        this._reconnecting = false;
        this.emit("reconnected", attempts);
    }

    private _handleMethodResponse(response: Response) {
        if (typeof response.id === "string") {
            this.emit("unkown_response", response);
            return;
        }

        const handler = this._responseHandlers.get(response.id as number);

        if (!handler) {
            this.emit("unkown_response", response);
            return;
        }

        this._responseHandlers.delete(response.id as number);

        const [timer, resolve, reject] = handler;

        clearTimeout(timer);

        if (isSuccessResponse(response)) {
            resolve(response.result);
        } else {
            reject(response.error);
        }
    }
}
