import { callbackify } from "util";

/**
 * JSON-RPC 2.0 Call Basic
 */
export interface Call {
    /**
     * A String specifying the version of the JSON-RPC protocol. MUST be exactly "2.0".
     */
    jsonrpc: "2.0";
}

/**
 * JSON-RPC 2.0 Notification
 */
export interface Notification extends Call {
    /**
     * A String containing the name of the method to be invoked. Method names that begin with the word rpc followed by a period character (U+002E or ASCII 46) are reserved for rpc-internal methods and extensions and MUST NOT be used for anything else.
     */
    method: string;
    /**
     * A Structured value that holds the parameter values to be used during the invocation of the method. This member MAY be omitted.
     */
    params?: object;
}

/**
 * JSON-RPC 2.0 Request
 */
export interface Request extends Call {
    /**
     * A String containing the name of the method to be invoked. Method names that begin with the word rpc followed by a period character (U+002E or ASCII 46) are reserved for rpc-internal methods and extensions and MUST NOT be used for anything else.
     */
    method: string;
    /**
     * A Structured value that holds the parameter values to be used during the invocation of the method. This member MAY be omitted.
     */
    params?: object;
    /**
     * An identifier established by the Client that MUST contain a String, Number, or NULL value if included. If it is not included it is assumed to be a notification. The value SHOULD normally not be Null [1] and Numbers SHOULD NOT contain fractional parts [2]
     */
    id: string | number | null;
}

/**
 * JSON-RPC 2.0 Error Response
 */
export interface ErrorResponse extends Call {
    /**
     * This member is REQUIRED on error.
     * This member MUST NOT exist if there was no error triggered during invocation.
     * The value for this member MUST be an Object as defined in section 5.1.
     */
    error: Error;
    /**
     * This member is REQUIRED.
     * It MUST be the same as the value of the id member in the Request Object.
     * If there was an error in detecting the id in the Request object (e.g. Parse error/Invalid Request), it MUST be Null.
     */
    id: string | number | null;
}

/**
 * JSON-RPC 2.0 Success Response
 */
export interface SuccessResponse extends Call {
    /**
     * This member is REQUIRED on success.
     * This member MUST NOT exist if there was an error invoking the method.
     * The value of this member is determined by the method invoked on the Server.
     */
    result: any;
    /**
     * This member is REQUIRED on error.
     * This member MUST NOT exist if there was no error triggered during invocation.
     * The value for this member MUST be an Object as defined in section 5.1.
     */
    id: string | number | null;
}

/**
 * JSON-RPC 2.0 Response
 */
export interface Response extends Call {
    /**
     * This member is REQUIRED on success.
     * This member MUST NOT exist if there was an error invoking the method.
     * The value of this member is determined by the method invoked on the Server.
     */
    result?: any;
    /**
     * This member is REQUIRED on error.
     * This member MUST NOT exist if there was no error triggered during invocation.
     * The value for this member MUST be an Object as defined in section 5.1.
     */
    error?: Error;
    /**
     * This member is REQUIRED.
     * It MUST be the same as the value of the id member in the Request Object.
     * If there was an error in detecting the id in the Request object (e.g. Parse error/Invalid Request), it MUST be Null.
     */
    id: string | number | null;
}

/**
 * Check type of call is an Reponse or not
 * @param call an Call object which will be checked.
 */
export function isResponse(call: Request | Notification | Response): call is Response {
    return "id" in call && ("result" in call || "error" in call);
}

/**
 * Check type of response is SuccessResponse or not
 *
 * @param response an Response object which will be checked.
 */
export function isSuccessResponse(response: Response): response is SuccessResponse {
    return "result" in response && response.id !== null;
}

/**
 * JSON-RPC 2.0 Error Object
 */
export interface Error {
    /**
     * A Number that indicates the error type that occurred.
     * This MUST be an integer.
     */
    code: number;
    /**
     * A String providing a short description of the error.
     * The message SHOULD be limited to a concise single sentence.
     */
    message: string;
    /**
     * A Primitive or Structured value that contains additional information about the error.
     * This may be omitted.
     * The value of this member is defined by the Server (e.g. detailed error information, nested errors etc.).
     */
    data?: any;
}

export const enum ErrorCode {
    ParseError = -32700,
    InvalidRequest = -32600,
    MethodNotFound = -32601,
    InvalidParams = -32602,
    InternalError = -32603,
    ServerError = -32000
}

/**
 * JSON-RPC 2.0 Error Codes
 */
export const errorCodeMap = new Map([
    [-32700, "Parse error"],
    [-32600, "Invalid Request"],
    [-32601, "Method not found"],
    [-32602, "Invalid params"],
    [-32603, "Internal error"],
    [-32000, "Server error"]
]);

/**
 * Creates a JSON-RPC 2.0 compliant Error Object
 * @param code A Number that indicates the error type that occurred. (Integer)
 * @param data A Primitive or Structured value that contains additional information about the error.
 */
export function createError(code: number, message?: string, data?: any): Error {

    const error: Error = {
        code: code,
        message: message || errorCodeMap.get(code) || "Server error"
    };

    if (data !== undefined) {
        error.data = data;
    }

    return error;
}
