import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from "fs";
import os from "os";
import { join } from "path";

import { rankIndex } from "../../lib/rankIndex.js";
import { viewIndex } from "../../lib/viewIndex.js";

const originalFsRoot = process.env.FS;
const originalPageSize = process.env.PAGESIZE;
let testRoot;
let collectionPath;
let indexPath;

function writeIndex(entries) {
    const contents = entries.length === 0
        ? ""
        : `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
    writeFileSync(indexPath, contents);
}

beforeEach(() => {
    testRoot = mkdtempSync(join(os.tmpdir(), "facesdb-rank-index-"));
    process.env.FS = testRoot;
    process.env.PAGESIZE = "2";
    collectionPath = join(testRoot, "players");
    indexPath = join(collectionPath, "scores.jsonl");
    mkdirSync(collectionPath);
});

afterEach(() => {
    if (originalFsRoot === undefined) {
        delete process.env.FS;
    } else {
        process.env.FS = originalFsRoot;
    }
    if (originalPageSize === undefined) {
        delete process.env.PAGESIZE;
    } else {
        process.env.PAGESIZE = originalPageSize;
    }
    rmSync(testRoot, { recursive: true, force: true });
});

describe("rankIndex", () => {
    test("sorts ascending and can be viewed in ranked order", async () => {
        writeIndex([
            { _id: "third", score: 30 },
            { _id: "first", score: 10 },
            { _id: "second", score: 20 },
        ]);

        await rankIndex("scores", "players", (a, b) => a.score - b.score);

        expect(await viewIndex("scores", "players", Infinity)).toEqual([
            { _id: "first", score: 10 },
            { _id: "second", score: 20 },
            { _id: "third", score: 30 },
        ]);
    });

    test("sorts descending while preserving the order of ties", async () => {
        writeIndex([
            { _id: "low", score: 1 },
            { _id: "tie-a", score: 3 },
            { _id: "tie-b", score: 3 },
            { _id: "middle", score: 2 },
        ]);

        await rankIndex("scores", "players", (a, b) => b.score - a.score);

        expect(await viewIndex("scores", "players", Infinity)).toEqual([
            { _id: "tie-a", score: 3 },
            { _id: "tie-b", score: 3 },
            { _id: "middle", score: 2 },
            { _id: "low", score: 1 },
        ]);
    });

    test("excludes entries before calling the sorter", async () => {
        writeIndex([
            { _id: "included", score: 1 },
            { _id: "excluded", score: "not-a-number", hidden: true },
            { _id: "winner", score: 2 },
        ]);
        const comparedIds = [];

        await rankIndex(
            "scores",
            "players",
            (a, b) => {
                comparedIds.push(a._id, b._id);
                return b.score - a.score;
            },
            (entry) => entry.hidden === true,
        );

        expect(comparedIds).not.toContain("excluded");
        expect(await viewIndex("scores", "players", Infinity)).toEqual([
            { _id: "winner", score: 2 },
            { _id: "included", score: 1 },
        ]);
    });

    test("supports an empty index", async () => {
        writeIndex([]);

        await expect(
            rankIndex("scores", "players", () => 0),
        ).resolves.toBeUndefined();
        expect(readFileSync(indexPath, "utf8")).toBe("");
    });

    test.each([
        [null, undefined],
        [() => 0, null],
    ])("rejects invalid callbacks", async (sorter, exclusion) => {
        writeIndex([{ _id: "entry", score: 1 }]);

        await expect(
            rankIndex("scores", "players", sorter, exclusion),
        ).rejects.toThrow("Cannot start rankIndex");
    });

    test.each([
        ["invalid-index", "players"],
        ["scores", "invalid collection"],
    ])("rejects invalid index and collection names", async (index, collection) => {
        writeIndex([{ _id: "entry", score: 1 }]);

        await expect(
            rankIndex(index, collection, () => 0),
        ).rejects.toThrow("Cannot start rankIndex");
    });

    test("preserves the index when JSONL is malformed", async () => {
        const original = '{"_id":"valid","score":1}\nnot-json\n';
        writeFileSync(indexPath, original);

        await expect(
            rankIndex("scores", "players", (a, b) => a.score - b.score),
        ).rejects.toThrow("Cannot run rankIndex");

        expect(readFileSync(indexPath, "utf8")).toBe(original);
    });

    test("preserves the index when exclusion or sorting fails", async () => {
        writeIndex([
            { _id: "one", score: 1 },
            { _id: "two", score: 2 },
        ]);
        const original = readFileSync(indexPath, "utf8");

        await expect(
            rankIndex("scores", "players", () => 0, () => {
                throw new Error("exclusion failed");
            }),
        ).rejects.toThrow("Cannot run rankIndex:exclusion failed");
        expect(readFileSync(indexPath, "utf8")).toBe(original);

        await expect(
            rankIndex("scores", "players", () => {
                throw new Error("sort failed");
            }),
        ).rejects.toThrow("Cannot run rankIndex:sort failed");
        expect(readFileSync(indexPath, "utf8")).toBe(original);
    });

    test("preserves the index and cleans up when serialization fails", async () => {
        writeIndex([
            { _id: "one", score: 1 },
            { _id: "two", score: 2 },
        ]);
        const original = readFileSync(indexPath, "utf8");

        await expect(
            rankIndex("scores", "players", (a, b) => {
                a.circular = a;
                return a.score - b.score;
            }),
        ).rejects.toThrow("Cannot run rankIndex");

        expect(readFileSync(indexPath, "utf8")).toBe(original);
        expect(readdirSync(collectionPath)).toEqual(["scores.jsonl"]);
    });
});
