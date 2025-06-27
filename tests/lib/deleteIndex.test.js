import { vi, beforeEach, describe, test, expect } from "vitest";
import { deleteIndex } from "../../lib/deleteIndex";

let checkCollection = vi.spyOn(
    await import("../../utils/checks"),
    "checkCollection",
);
let checkIndex = vi.spyOn(await import("../../utils/checks"), "checkIndex");
let exists = vi.spyOn(await import("../../utils/fs"), "exists");
let rm = vi.spyOn(await import("../../utils/fs"), "rm");

beforeEach(() => {
    checkCollection.mockClear();
    checkIndex.mockClear();
    exists.mockClear();
    rm.mockClear();
});

describe("Normal run", () => {
    test("Should delete index if it exists", async () => {
        checkIndex.mockImplementation(() => null);
        checkCollection.mockImplementation(() => null);
        exists.mockImplementation(() => true);
        rm.mockImplementation(() => {});

        let index = "indexname";
        let collection = "collectionname";

        await deleteIndex(index, collection);

        expect(rm).toHaveBeenCalledWith(collection, `${index}.json`);
    });
});

describe("Initialization error", () => {
    test("Should throw error for invalid index", async () => {
        checkIndex.mockImplementation(() => new Error("Error"));
        checkCollection.mockImplementation(() => null);

        let index = "indexname";
        let collection = "collectionname";

        await expect(deleteIndex(index, collection)).rejects.toThrowError(
            "Cannot start deleteIndex:Error",
        );
    });

    test("Should throw error for invalid collection", async () => {
        checkIndex.mockImplementation(() => null);
        checkCollection.mockImplementation(() => new Error("Error"));

        let index = "indexname";
        let collection = "collectionname";

        await expect(deleteIndex(index, collection)).rejects.toThrowError(
            "Cannot start deleteIndex:Error",
        );
    });
});

describe("Function errors", () => {
    test("Should throw error if rm fails", async () => {
        checkIndex.mockImplementation(() => null);
        checkCollection.mockImplementation(() => null);
        exists.mockImplementation(() => true);
        rm.mockImplementation(() => {
            throw new Error("Error");
        });

        let index = "indexname";
        let collection = "collectionname";

        await expect(deleteIndex(index, collection)).rejects.toThrowError(
            "Cannot run deleteIndex:Error",
        );
    });
});
