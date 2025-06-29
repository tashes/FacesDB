import { join } from "path";
import {
    appendFileSync,
    existsSync,
    lstatSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "fs";

import { env } from "./env";
import { Wrap } from "./errors";

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

export function writejson(obj, ...parts) {
    return writeFileSync(path(...parts), JSON.stringify(obj));
}

export function appendjsonl(obj, ...parts) {
    return appendFileSync(path(...parts), JSON.stringify(obj));
}

export async function deletejsonl(id, ...parts) {
    const tempPath = path.join(os.tmpdir(), `temp-${Date.now()}.jsonl`);
    const input = fs.createReadStream(path(...parts));
    const output = fs.createWriteStream(tempPath);
    const rl = readline.createInterface({ input });

    for await (const line of rl) {
        try {
            const obj = JSON.parse(line);
            if (obj._id !== id) {
                output.write(line + "\n");
            }
        } catch (err) {
            Wrap("Cannot run deletejsonl", err);
        }
    }

    rl.close();
    output.end();
    await new Promise((resolve) => output.on("finish", resolve));
    fs.renameSync(tempPath, path(...parts));
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
            Wrap("Cannot run editjsonl", err);
        }
    }

    rl.close();
    output.end();
    await new Promise((resolve) => output.on("finish", resolve));
    fs.renameSync(tempPath, path(...parts));
}

export async function editjsonlraw(id, obj, ...parts) {
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
            Wrap("Cannot run editjsonl", err);
        }
    }

    rl.close();
    output.end();
    await new Promise((resolve) => output.on("finish", resolve));
    fs.renameSync(tempPath, path(...parts));
}

export async function jsonlexists(id, ...parts) {
    const input = fs.createReadStream(path(...parts));
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
    const input = fs.createReadStream(path(...parts));
    const rl = readline.createInterface({ input });

    let currentLine = from;

    for await (const line of rl) {
        currentLine++;
        if (currentLine >= from && currentLine <= to) {
            try {
                const obj = JSON.parse(line);
                objects.push(obj);
            } catch (err) {
                Wrap("Cannot run pulljsonl", err);
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

export function rm(...parts) {
    return rmSync(path(...parts), {
        recursive: true,
    });
}
