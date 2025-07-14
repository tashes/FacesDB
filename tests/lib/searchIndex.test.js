import { vi, beforeEach, describe, test, expect } from "vitest";
import { searchIndex } from "../../lib/searchIndex";

let checkIndex = vi.spyOn(await import("../../utils/checks"), "checkIndex");
let checkCollection = vi.spyOn(
    await import("../../utils/checks"),
    "checkCollection",
);
let checkFn = vi.spyOn(await import("../../utils/checks"), "checkFn");
let checkPageNumber = vi.spyOn(
    await import("../../utils/checks"),
    "checkPageNumber",
);
let env = vi.spyOn(await import("../../utils/env"), "env");
let forjsonl = vi.spyOn(await import("../../utils/fs"), "forjsonl");

beforeEach(() => {
    checkIndex.mockClear();
    checkCollection.mockClear();
    checkFn.mockClear();
    checkPageNumber.mockClear();
    env.mockClear();
    forjsonl.mockClear();
});

describe("Normal run", () => {
    test("Should search index if no errors", async () => {
        checkIndex.mockImplementation(() => null);
        checkCollection.mockImplementation(() => null);
        checkFn.mockImplementation(() => null);
        checkPageNumber.mockImplementation(() => null);
        env.mockImplementation(() => 10); // Assuming page size is 10
        const fakeResults = [{ _id: "doc1" }, { _id: "doc2" }];
        forjsonl.mockImplementation(
            (processFn, stopFn, collection, filename) => {
                fakeResults.forEach(processFn);
                return;
            },
        );

        const index = "indexname";
        const collection = "collectionname";
        const fn = (obj) => true;
        const pageNumber = 0;
        const result = await searchIndex(index, collection, fn, pageNumber);

        expect(result).toEqual(fakeResults);
        expect(env).toHaveBeenCalledWith("PAGESIZE");
        expect(forjsonl).toHaveBeenCalledWith(
            expect.any(Function),
            expect.any(Function),
            "collectionname",
            "indexname.jsonl",
        );
    });
});

describe("Initialization error", () => {
    test("Should throw error for invalid index", async () => {
        checkIndex.mockImplementation(() => new Error("Error"));

        const index = "indexname";
        const collection = "collectionname";
        const fn = (obj) => true;
        const pageNumber = 1;

        await expect(
            searchIndex(index, collection, fn, pageNumber),
        ).rejects.toThrowError("Cannot start searchIndex:Error");
    });

    test("Should throw error for invalid collection", async () => {
        checkIndex.mockImplementation(() => null);
        checkCollection.mockImplementation(() => new Error("Error"));

        const index = "indexname";
        const collection = "collectionname";
        const fn = (obj) => true;
        const pageNumber = 1;

        await expect(
            searchIndex(index, collection, fn, pageNumber),
        ).rejects.toThrowError("Cannot start searchIndex");
    });

    test("Should throw error for invalid function", async () => {
        checkIndex.mockImplementation(() => null);
        checkCollection.mockImplementation(() => null);
        checkFn.mockImplementation(() => new Error("Error"));

        const index = "indexname";
        const collection = "collectionname";
        const fn = "notAFunction";
        const pageNumber = 1;

        await expect(
            searchIndex(index, collection, fn, pageNumber),
        ).rejects.toThrowError("Cannot start searchIndex:Error");
    });

    test("Should throw error for invalid page number", async () => {
        checkIndex.mockImplementation(() => null);
        checkCollection.mockImplementation(() => null);
        checkFn.mockImplementation(() => null);
        checkPageNumber.mockImplementation(() => new Error("Error"));

        const index = "indexname";
        const collection = "collectionname";
        const fn = (obj) => true;
        const pageNumber = 1;

        await expect(
            searchIndex(index, collection, fn, pageNumber),
        ).rejects.toThrowError("Cannot start searchIndex:Error");
    });
});

describe("Function errors", () => {
    test("Should throw error if forjsonl fails", async () => {
        checkIndex.mockImplementation(() => null);
        checkCollection.mockImplementation(() => null);
        checkFn.mockImplementation(() => null);
        checkPageNumber.mockImplementation(() => null);
        env.mockImplementation(() => 10); // Assuming page size is 10
        forjsonl.mockImplementation(() => {
            throw new Error("Error");
        });

        const index = "indexname";
        const collection = "collectionname";
        const fn = (obj) => true;
        const pageNumber = 1;

        await expect(
            searchIndex(index, collection, fn, pageNumber),
        ).rejects.toThrowError("Cannot run searchIndex:Error");
    });
});
