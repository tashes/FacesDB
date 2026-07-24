import {
    mkdirSync,
    mkdtempSync,
    existsSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from "fs";
import os from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createIndex } from "../../lib/createIndex.js";
import { putDocument } from "../../lib/putDocument.js";

const originalRoot = process.env.FS;
let root;
let collection;

function id(index) {
    return index.toString(16).padStart(24, "0");
}

function writeDocument(index, value) {
    const document = id(index);
    writeFileSync(
        join(collection, `${document}.json`),
        JSON.stringify({ _id: document, ...value }),
    );
    return document;
}

beforeEach(() => {
    root = mkdtempSync(join(os.tmpdir(), "facesdb-create-index-"));
    process.env.FS = root;
    collection = join(root, "people");
    mkdirSync(collection);
    mkdirSync(join(collection, "bucket"));
});

afterEach(() => {
    if (originalRoot === undefined) delete process.env.FS;
    else process.env.FS = originalRoot;
    rmSync(root, { recursive: true, force: true });
});

describe("createIndex", () => {
    test("streams qualifying documents into a published index", async () => {
        const included = writeDocument(1, { name: "Ada", active: true });
        writeDocument(2, { active: false });

        await createIndex("names", { name: true, active: false }, "people");

        expect(JSON.parse(readFileSync(join(collection, "names.json"), "utf8")))
            .toEqual({ name: true, active: false });
        expect(readFileSync(join(collection, "names.jsonl"), "utf8"))
            .toBe(`${JSON.stringify({ _id: included, name: "Ada", active: true })}\n`);
    });

    test("handles thousands of records without per-entry append files", async () => {
        for (let index = 0; index < 5_000; index += 1) {
            writeDocument(index, { score: index });
        }

        await createIndex("scores", { score: true }, "people");

        const lines = readFileSync(join(collection, "scores.jsonl"), "utf8")
            .trim()
            .split("\n");
        expect(lines).toHaveLength(5_000);
    });

    test("journals document changes made while an index is building", async () => {
        const target = writeDocument(0, { score: 0 });
        for (let index = 1; index < 5_000; index += 1) {
            writeDocument(index, { score: index });
        }
        const building = createIndex("scores", { score: true }, "people");
        const marker = join(collection, ".scores.building.json");
        while (existsSync(marker) === false) {
            await new Promise((resolve) => setTimeout(resolve, 1));
        }
        await putDocument("people", target, { score: 99_999 });
        await building;

        const entry = readFileSync(join(collection, "scores.jsonl"), "utf8")
            .split("\n")
            .filter(Boolean)
            .map(JSON.parse)
            .find((candidate) => candidate._id === target);
        expect(entry.score).toBe(99_999);
        expect(existsSync(marker)).toBe(false);
    }, 10_000);

    test("rejects an existing index without changing it", async () => {
        writeFileSync(join(collection, "names.json"), JSON.stringify({ old: true }));
        writeFileSync(join(collection, "names.jsonl"), "old\n");

        await expect(createIndex("names", { name: true }, "people"))
            .rejects.toThrow("Cannot run createIndex:Index exists");
        expect(readFileSync(join(collection, "names.jsonl"), "utf8")).toBe("old\n");
    });

    test.each([
        ["invalid-index", { name: true }, "people"],
        ["names", { name: "yes" }, "people"],
        ["names", { name: true }, "invalid collection"],
    ])("validates index inputs", async (index, config, collectionName) => {
        await expect(createIndex(index, config, collectionName))
            .rejects.toThrow("Cannot start createIndex");
    });

    test("leaves no published or temporary index after a build failure", async () => {
        writeDocument(1, { name: "valid" });
        writeFileSync(join(collection, `${id(2)}.json`), "not-json");

        await expect(createIndex("names", { name: true }, "people"))
            .rejects.toThrow("Cannot run createIndex");

        expect(readdirSync(collection).filter((name) => name.startsWith("names")))
            .toEqual([]);
        expect(readdirSync(collection).some((name) => name.endsWith(".tmp")))
            .toBe(false);
    });
});
