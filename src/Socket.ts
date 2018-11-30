import EventEmitter = require("eventemitter3");
import { Data } from "ws";

export interface Socket extends EventEmitter {
    /**
     * Sends a (raw) message to the socket.
     * @param data The data to send.
     * @param isBinary Send
     */
    send(data: Data, binary: boolean): void;
}
