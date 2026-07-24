import { createReadStream, mkdirSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { join } from 'path'
import readline from 'readline'

import {
    checkCollection,
    checkFn,
    checkIndex,
} from "../utils/checks.js";
import { Wrap } from "../utils/errors.js";
import { openjsonlwriter, path } from "../utils/fs.js";
import { refreshIndexSidecars } from "./indexSidecar.js";

const DEFAULT_CHUNK_SIZE = 50_000;

function compareEntries(left, right, sorter) {
    const result = Number(sorter(left.entry, right.entry));
    return Number.isNaN(result) || result === 0
        ? left.position - right.position
        : result;
}

class MinHeap {
    constructor(compare) {
        this.compare = compare;
        this.values = [];
    }

    push(value) {
        this.values.push(value);
        let index = this.values.length - 1;
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (this.compare(this.values[parent], value) <= 0) break;
            this.values[index] = this.values[parent];
            index = parent;
        }
        this.values[index] = value;
    }

    pop() {
        if (this.values.length === 0) return undefined;
        const first = this.values[0];
        const last = this.values.pop();
        if (this.values.length === 0) return first;

        let index = 0;
        while (true) {
            const left = index * 2 + 1;
            const right = left + 1;
            if (left >= this.values.length) break;
            let child = left;
            if (
                right < this.values.length &&
                this.compare(this.values[right], this.values[left]) < 0
            ) child = right;
            if (this.compare(last, this.values[child]) <= 0) break;
            this.values[index] = this.values[child];
            index = child;
        }
        this.values[index] = last;
        return first;
    }

    get size() {
        return this.values.length;
    }
}

function writeRun(runDirectory, runNumber, entries, sorter) {
    entries.sort((left, right) => compareEntries(left, right, sorter));
    const runPath = join(runDirectory, `${runNumber}.jsonl`);
    writeFileSync(
        runPath,
        `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    );
    return runPath;
}

function openRun(runPath) {
    const input = createReadStream(runPath);
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    const iterator = lines[Symbol.asyncIterator]();
    return {
        async next() {
            const result = await iterator.next();
            if (result.done) return undefined;
            return JSON.parse(result.value);
        },
        close() {
            lines.close();
            input.destroy();
        },
    };
}

async function createRuns(source, runDirectory, sorter, exclusion, chunkSize) {
    const input = createReadStream(source);
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    const runs = [];
    let chunk = [];
    let position = 0;
    try {
        for await (const line of lines) {
            if (line.length === 0) continue;
            const entry = JSON.parse(line);
            const currentPosition = position;
            position += 1;
            if (exclusion?.(entry) === true) continue;
            chunk.push({ entry, position: currentPosition });
            if (chunk.length >= chunkSize) {
                runs.push(writeRun(runDirectory, runs.length, chunk, sorter));
                chunk = [];
            }
        }
        if (chunk.length > 0) {
            runs.push(writeRun(runDirectory, runs.length, chunk, sorter));
        }
        return runs;
    } finally {
        lines.close();
        input.destroy();
    }
}

async function mergeRuns(runs, writer, sorter) {
    const readers = runs.map(openRun);
    const heap = new MinHeap((left, right) => (
        compareEntries(left.value, right.value, sorter)
    ));
    try {
        for (let index = 0; index < readers.length; index += 1) {
            const value = await readers[index].next();
            if (value !== undefined) heap.push({ reader: index, value });
        }
        while (heap.size > 0) {
            const next = heap.pop();
            writer.write(next.value.entry);
            const value = await readers[next.reader].next();
            if (value !== undefined) heap.push({ reader: next.reader, value });
        }
    } finally {
        readers.forEach((reader) => reader.close());
    }
}

export async function rankIndex(
    index,
    collection,
    sorter,
    exclusion,
    { chunkSize = DEFAULT_CHUNK_SIZE } = {},
) {
    const indexError = checkIndex(index);
    if (indexError instanceof Error)
        throw Wrap("Cannot start rankIndex", indexError);
    const collectionError = checkCollection(collection);
    if (collectionError instanceof Error)
        throw Wrap("Cannot start rankIndex", collectionError);
    const sorterError = checkFn(sorter);
    if (sorterError instanceof Error)
        throw Wrap("Cannot start rankIndex", sorterError);
    if (exclusion !== undefined) {
        const exclusionError = checkFn(exclusion);
        if (exclusionError instanceof Error)
            throw Wrap("Cannot start rankIndex", exclusionError);
    }
    if (Number.isSafeInteger(chunkSize) === false || chunkSize <= 0) {
        throw Wrap("Cannot start rankIndex", new Error("Invalid chunk size"));
    }

    const runDirectory = path(
        collection,
        `.${index}.rank-${process.pid}-${randomUUID()}`,
    );
    let writer;
    try {
        mkdirSync(runDirectory);
        const runs = await createRuns(
            path(collection, `${index}.jsonl`),
            runDirectory,
            sorter,
            exclusion,
            chunkSize,
        );
        writer = openjsonlwriter(collection, `${index}.jsonl`);
        await mergeRuns(runs, writer, sorter);
        writer.commit();
        writer = undefined;
        await refreshIndexSidecars(index, collection);
    } catch (err) {
        writer?.abort();
        throw Wrap("Cannot run rankIndex", err);
    } finally {
        rmSync(runDirectory, { recursive: true, force: true });
    }
}
