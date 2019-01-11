import { Socket } from "./Socket";
import { Notification, Request, Response, createError, isResponse, ErrorCode, Error as RPCError, ErrorResponse } from "./common";
import { Data } from "isomorphic-ws";
import EventEmitter = require("eventemitter3");

export const enum VERSION_CHECK_MODE {
    STRICT,
    LOOSE,
    IGNORE
}

export interface Options {
    /**
     * `STRICT`: only accepts jsonrpc: `2.0`.
     * `LOOSE`: accepts jsonrpc: `2.0` but it's omittable.
     * `IGNORE`: ignore jsonrpc property.
     */
    jsonrpcVersionCheck?: VERSION_CHECK_MODE;

    /**
     * response handler
     */
    onResponse?: (response: Response) => void;
}

type MethodFunction<SOC extends Socket = Socket> = (socket: SOC, params: any) => Promise<any> | any;
export type MethodMap<SOC extends Socket = Socket> = Map<string, MethodFunction<SOC>>;

export default interface MessageHandler<SOC extends Socket = Socket> {
    on(event: "response", handler: (socket: SOC, response: Response) => void ): this;
    on(event: "method_response", handler: (socket: SOC, response: Response) => void ): this;
    on(event: "error_response", handler: (socket: SOC, response: ErrorResponse) => void ): this;
    on(event: "notification_error", handler: (socket: SOC, error: RPCError) => void ): this;
}

export default class MessageHandler<SOC extends Socket = Socket> extends EventEmitter {
    methods: MethodMap<SOC> = new Map();

    constructor(readonly options: Options) {
        super();
    }

    async handleMessage(socket: SOC, data: Data): Promise<void> {

        const calls: (Request | Notification)[] = [];
        const responses: Response[] = [];

        let isBinary = false;
        let isArray = false;

        if (data instanceof ArrayBuffer) {
            isBinary = true;
            data = Buffer.from(data).toString();
        } else if (data instanceof Buffer) {
            isBinary = true;
            data = data.toString();
        } else if (Array.isArray(data)) {
            isBinary = true;
            data = "[" + data.map(buf => buf.toString()).join(",") + "]";
        }

        try {
            const obj = JSON.parse(data);
            if (Array.isArray(obj)) {
                isArray = true;

                if (obj.length === 0) {
                    const res: Response = {
                        jsonrpc: "2.0",
                        error: createError(ErrorCode.InvalidRequest, null, "Empty Array"),
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
                error: createError(ErrorCode.ParseError, null, "Invalid JSON"),
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

    private async _processCall(socket: SOC, call: Response | Request | Notification): Promise<Response | void> {

        const reqId = (<Request> call).id;

        const res: Response = {
            jsonrpc: "2.0",
            id: reqId === undefined ? null : reqId
        };

        if (typeof call !== "object") {
            res.error = createError(ErrorCode.InvalidRequest);
            return res;
        }

        if (
            call.jsonrpc !== "2.0" && (
                this.options.jsonrpcVersionCheck === VERSION_CHECK_MODE.STRICT ||
                (this.options.jsonrpcVersionCheck === VERSION_CHECK_MODE.LOOSE && call.jsonrpc !== undefined)
            )
        ) {
            res.error = createError(ErrorCode.InvalidRequest, null, "Invalid JSON-RPC Version");
            return res;
        }

        if (isResponse(call)) {
            this.emit("response", socket, call);
            if (call.id !== null) {
                this.emit("method_response", socket, call);
                return;
            }

            if (!call.error) {
                res.error = createError(ErrorCode.InvalidRequest);
                return res;
            }

            this.emit("error_response", socket, call);

            if (call.error.code === ErrorCode.ParseError || call.error.code === ErrorCode.InvalidRequest) {
                return;
            }

            this.emit("notification_error", socket, call.error);
            return;
        }

        if (!call.method) {
            res.error = createError(ErrorCode.MethodNotFound, null, "Method not specified");
            return res;
        }

        if (typeof call.method !== "string") {
            res.error = createError(ErrorCode.InvalidRequest, null, "Invalid type of method name");
            return res;
        }

        if ("params" in call && (typeof call.params !== "object" || call.params === null)) {
            res.error = createError(ErrorCode.InvalidRequest);
            return res;
        }

        if (this.methods.has(call.method) === false) {
            res.error = createError(ErrorCode.MethodNotFound);
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
                res.error = createError(ErrorCode.ServerError, e.name, e.message);
            } else {
                res.error = e;
            }
            return res;
        }
    }
}
