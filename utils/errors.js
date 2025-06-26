export function Wrap(message, error) {
    let e = new Error(`${message}:${error.message}`);
    e.stack = error.stack;
    return e;
}

export function List(errors) {
    let e = new Error(`[${errors.map((oe) => oe.message).join(",")}]`);
    return e;
}

export function Unwrap(wrappedError) {
    let message = wrappedError.message
        .split(":")
        .map((a) => a.trim())
        .reverse();
    let stack = wrappedError.stack.split("\n");
    stack.shift();
    let errs = [];
    let len = message.length;
    for (let i = 0; i < len; i++) {
        let err = new Error(message[i]);
        err.stack = [`Error: ${message[i]}`, ...stack].join("\n");
        stack.shift();
        errs.push(err);
    }
    return errs;
}

export function Has(wrappedError, errorMessage) {
    let errors = Unwrap(wrappedError);
    let len = errors.length;
    for (let i = 0; i < len; i++) {
        let err = errors[i];
        if (err.message === errorMessage) {
            return true;
        }
    }
    return false;
}

export function Panic(location, panicError, handledError) {
    let e = new Error(
        `Error recovering at ${location} from error: ${handledError.message}. ERROR THROWN: ${panicError.message}`,
    );
    e.stack = panicError.stack;
    console.error(e);
}
