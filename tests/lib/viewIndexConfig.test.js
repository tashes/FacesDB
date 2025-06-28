import { vi, beforeEach, describe, test, expect } from "vitest";
import { viewIndexConfig } from "../../lib/viewIndexConfig";

let checkCollection = vi.spyOn(
    await import("../../utils/checks"),
    "checkCollection",
);
let checkIndex = vi.spyOn(await import("../../utils/checks"), "checkIndex");
let exists = vi.spyOn(await import("../../utils/fs"), "exists");
let readfile = vi.spyOn(await import("../../utils/fs"), "readfile");

beforeEach(() => {
    checkCollection.mockClear();
    checkIndex.mockClear();
    exists.mockClear();
    readfile.mockClear();
});

describe("Normal run", () => {
    test("Should view index config if no errors", async () => {
        checkCollection.mockImplementation(() => null);
        checkIndex.mockImplementation(() => null);
        exists.mockImplementation(() => true);
        const fakeIndexConfig = { prop1: true, prop2: false };
        readfile.mockImplementation(() => JSON.stringify(fakeIndexConfig));

        const index = "indexname";
        const collection = "collectionname";
        const result = await viewIndexConfig(index, collection);

        expect(result).toEqual(fakeIndexConfig);
        expect(exists).toHaveBeenCalledWith(collection, `${index}.json`);
        expect(readfile).toHaveBeenCalledWith(collection, `${index}.json`);
    });
});

describe("Initialization error", () => {
    test("Should throw error for invalid index", async () => {
        checkIndex.mockImplementation(() => new Error("Error"));
        checkCollection.mockImplementation(() => null);

        const index = "indexname";
        const collection = "collectionname";

        await expect(viewIndexConfig(index, collection)).rejects.toThrowError(
            "Cannot start viewIndexConfig:Error",
        );
    });

    test("Should throw error for invalid collection", async () => {
        checkIndex.mockImplementation(() => null);
        checkCollection.mockImplementation(() => new Error("Error"));

        const index = "indexname";
        const collection = "collectionname";

        await expect(viewIndexConfig(index, collection)).rejects.toThrowError(
            "Cannot start viewIndexConfig:Error",
        );
    });
});

describe("Function errors", () => {
    test("Should throw error if readfile fails", async () => {
        checkCollection.mockImplementation(() => null);
        checkIndex.mockImplementation(() => null);
        exists.mockImplementation(() => true);
        readfile.mockImplementation(() => {
            throw new Error("Error");
        });

        const index = "indexname";
        const collection = "collectionname";

        await expect(viewIndexConfig(index, collection)).rejects.toThrowError(
            "Cannot run viewIndexConfig:Error",
        );
    });
});
