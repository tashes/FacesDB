import os from "os";
import { randomUUID } from "crypto";
import { basename, dirname, join } from "path";
import {
    appendFileSync,
    closeSync,
    createReadStream,
    createWriteStream,
    existsSync,
    fsyncSync,
    lstatSync,
    mkdirSync,
    openSync,
    promises as fsPromises,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync,
} from "fs";
import readline from "readline";

import { env } from "./env.js";
import { Wrap } from "./errors.js";

export function path(...parts) {
    let root = env("FS");

    return join(root, ...parts);
}

export function readdir(...parts) {
    return readdirSync(path(...parts));
}

export function exists(...parts) {
    return existsSync(path(...parts));
}

export function isFolder(...parts) {
    return lstatSync(path(...parts)).isDirectory();
}

export function isFile(...parts) {
    return lstatSync(path(...parts)).isFile();
}

export function createFolder(...parts) {
    mkdirSync(path(...parts));
}

export function readfile(...parts) {
    return readFileSync(path(...parts));
}

export function writefile(obj, ...parts) {
    writeFileSync(path(...parts), obj);
}

export function writejson(obj, ...parts) {
    return writeFileSync(path(...parts), JSON.stringify(obj));
}

export function appendjsonl(obj, ...parts) {
    const destination = path(...parts);
    const contents = Buffer.from(`${JSON.stringify(obj)}\n`);
    const offset = existsSync(destination) ? statSync(destination).size : 0;
    appendFileSync(destination, contents);
    return { offset, length: contents.length };
}

function syncFolder(directory) {
    const descriptor = openSync(directory, "r");
    try {
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
}

export function openjsonlwriter(...parts) {
    const destination = path(...parts);
    const directory = dirname(destination);
    const temporary = join(
        directory,
        `.${basename(destination)}.${process.pid}.${randomUUID()}.tmp`,
    );
    let descriptor = openSync(temporary, "wx");
    let buffer = "";
    let finished = false;

    function flush() {
        if (buffer.length === 0) return;
        writeFileSync(descriptor, buffer);
        buffer = "";
    }

    return {
        write(obj) {
            if (finished) throw new Error("JSONL writer is closed");
            buffer += `${JSON.stringify(obj)}\n`;
            if (buffer.length >= 1024 * 1024) flush();
        },
        commit() {
            if (finished) throw new Error("JSONL writer is closed");
            flush();
            fsyncSync(descriptor);
            closeSync(descriptor);
            descriptor = undefined;
            renameSync(temporary, destination);
            syncFolder(directory);
            finished = true;
        },
        abort() {
            if (finished) return;
            if (descriptor !== undefined) closeSync(descriptor);
            descriptor = undefined;
            rmSync(temporary, { force: true });
            finished = true;
        },
    };
}

export function atomicwritejson(obj, ...parts) {
    const destination = path(...parts);
    const directory = dirname(destination);
    const temporary = join(
        directory,
        `.${basename(destination)}.${process.pid}.${randomUUID()}.tmp`,
    );
    let descriptor;
    try {
        descriptor = openSync(temporary, "wx");
        writeFileSync(descriptor, JSON.stringify(obj));
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = undefined;
        renameSync(temporary, destination);
        syncFolder(directory);
    } catch (err) {
        if (descriptor !== undefined) closeSync(descriptor);
        rmSync(temporary, { force: true });
        throw err;
    }
}

export function replacejsonl(objs, ...parts) {
    const destination = path(...parts);
    const directory = dirname(destination);
    const temporary = join(
        directory,
        `.${basename(destination)}.${process.pid}.${randomUUID()}.tmp`,
    );
    const contents = objs.length === 0
        ? ""
        : `${objs.map((obj) => JSON.stringify(obj)).join("\n")}\n`;
    let descriptor;

    try {
        descriptor = openSync(temporary, "wx");
        writeFileSync(descriptor, contents);
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = undefined;
        renameSync(temporary, destination);
    } catch (e) {
        if (descriptor !== undefined) {
            closeSync(descriptor);
        }
        rmSync(temporary, { force: true });
        throw e;
    }
}

export async function deletejsonl(id, ...parts) {
    const tempPath = join(os.tmpdir(), `temp-${Date.now()}.jsonl`);
    const input = createReadStream(path(...parts));
    const output = createWriteStream(tempPath);
    const rl = readline.createInterface({ input });

    for await (const line of rl) {
        try {
            const obj = JSON.parse(line);
            if (obj._id !== id) {
                output.write(line + "\n");
            }
        } catch (err) {
            throw Wrap("Cannot run deletejsonl", err);
        }
    }

    rl.close();
    output.end();
    await new Promise((resolve) => output.on("finish", resolve));
    renameSync(tempPath, path(...parts));
}

export async function editjsonl(id, obj, ...parts) {
    const tempPath = path.join(os.tmpdir(), `temp-${Date.now()}.jsonl`);
    const input = fs.createReadStream(path(...parts));
    const output = fs.createWriteStream(tempPath);
    const rl = readline.createInterface({ input });

    for await (const line of rl) {
        try {
            const parsed = JSON.parse(line);
            if (parsed._id === id) {
                output.write(JSON.stringify(obj) + "\n");
            } else {
                output.write(line + "\n");
            }
        } catch (err) {
            throw Wrap("Cannot run editjsonl", err);
        }
    }

    rl.close();
    output.end();
    await new Promise((resolve) => output.on("finish", resolve));
    fs.renameSync(tempPath, path(...parts));
}

export async function editjsonlraw(id, obj, ...parts) {
    const tempPath = join(os.tmpdir(), `temp-${Date.now()}.jsonl`);
    const input = createReadStream(path(...parts));
    const output = createWriteStream(tempPath);
    const rl = readline.createInterface({ input });

    for await (const line of rl) {
        try {
            const parsed = JSON.parse(line);
            if (parsed._id === id) {
                output.write(JSON.stringify(obj) + "\n");
            } else {
                output.write(line + "\n");
            }
        } catch (err) {
            throw Wrap("Cannot run editjsonl", err);
        }
    }

    rl.close();
    output.end();
    await new Promise((resolve) => output.on("finish", resolve));
    renameSync(tempPath, path(...parts));
}

export async function jsonlexists(id, ...parts) {
    const input = createReadStream(path(...parts));
    const rl = readline.createInterface({ input });

    for await (const line of rl) {
        try {
            const obj = JSON.parse(line);
            if (obj._id === id) {
                rl.close();
                input.destroy();
                return true;
            }
        } catch (_) {}
    }

    return false;
}

export async function pulljsonl(from, to, ...parts) {
    const objects = [];
    const input = createReadStream(path(...parts));
    const rl = readline.createInterface({ input });

    let currentLine = from;

    for await (const line of rl) {
        currentLine++;
        if (currentLine >= from && currentLine <= to) {
            try {
                const obj = JSON.parse(line);
                if (typeof obj === "object") objects.push(obj);
            } catch (err) {
                throw Wrap("Cannot run pulljsonl", err);
            }
        }
        if (currentLine > to) {
            break;
        }
    }

    rl.close();
    input.destroy();
    return objects;
}

export async function forjsonl(fn = () => {}, stop = () => {}, ...parts) {
    const input = createReadStream(path(...parts));
    const rl = readline.createInterface({ input });
    for await (const line of rl) {
        if (stop() === true) break;
        try {
            const obj = JSON.parse(line);
            fn(obj);
        } catch (err) {
            throw Wrap("Cannot run forjsonl", err);
        }
    }
    rl.close();
    input.destroy();
}

export function rm(...parts) {
    return rmSync(path(...parts), {
        recursive: true,
    });
}

export async function rmConcurrent(...parts) {
    const target = path(...parts);

    async function removeTree(directory) {
        const childDirectories = [];
        let pendingFiles = [];
        const handle = await fsPromises.opendir(directory);

        async function flushFiles() {
            if (pendingFiles.length === 0) return;
            const current = pendingFiles;
            pendingFiles = [];
            await Promise.all(current.map((file) => fsPromises.unlink(file)));
        }

        try {
            for await (const entry of handle) {
                const child = join(directory, entry.name);
                if (entry.isDirectory() && entry.isSymbolicLink() === false) {
                    childDirectories.push(child);
                } else {
                    pendingFiles.push(child);
                    if (pendingFiles.length >= 32) await flushFiles();
                }
            }
            await flushFiles();
        } finally {
            await handle.close().catch((err) => {
                if (err.code !== "ERR_DIR_CLOSED") throw err;
            });
        }

        for (const child of childDirectories) await removeTree(child);
        await fsPromises.rmdir(directory);
    }

    return await removeTree(target);
}
