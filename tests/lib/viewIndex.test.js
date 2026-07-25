import { vi, beforeEach, describe, test, expect } from "vitest";
import { viewIndex } from "../../lib/viewIndex";

let checkCollection = vi.spyOn(
    await import("../../utils/checks"),
    "checkCollection",
);
let checkIndex = vi.spyOn(await import("../../utils/checks"), "checkIndex");
let checkPageNumber = vi.spyOn(
    await import("../../utils/checks"),
    "checkPageNumber",
);
let env = vi.spyOn(await import("../../utils/env"), "env");
let pulljsonl = vi.spyOn(await import("../../utils/fs"), "pulljsonl");
let readIndexRows = vi.spyOn(
    await import("../../lib/indexSidecar"),
    "readIndexRows",
);

beforeEach(() => {
    checkCollection.mockClear();
    checkIndex.mockClear();
    checkPageNumber.mockClear();
    env.mockClear();
    pulljsonl.mockClear();
    readIndexRows.mockClear();
});

describe("Normal run", () => {
    test("Should view index if no errors", async () => {
        checkCollection.mockImplementation(() => null);
        checkIndex.mockImplementation(() => null);
        checkPageNumber.mockImplementation(() => null);
        env.mockImplementation(() => 10); // Assuming page size is 10
        const fakeIndexContent = [{ _id: "doc1" }, { _id: "doc2" }];
        readIndexRows.mockImplementation(() => fakeIndexContent);

        const index = "indexname";
        const collection = "collectionname";
        const pageNumber = 1;
        const result = await viewIndex(index, collection, pageNumber);

        expect(result).toEqual(fakeIndexContent);
        expect(env).toHaveBeenCalledWith("PAGESIZE");
        expect(readIndexRows).toHaveBeenCalledWith(
            "indexname",
            "collectionname",
            10,
            10,
        );
    });
});

describe("Initialization error", () => {
    test("Should throw error for invalid index", async () => {
        checkIndex.mockImplementation(() => new Error("Error"));

        const index = "indexname";
        const collection = "collectionname";
        const pageNumber = 1;

        await expect(
            viewIndex(index, collection, pageNumber),
        ).rejects.toThrowError("Cannot start viewIndex:Error");
    });

    test("Should throw error for invalid collection", async () => {
        checkIndex.mockImplementation(() => null);
        checkCollection.mockImplementation(() => new Error("Error"));

        const index = "indexname";
        const collection = "collectionname";
        const pageNumber = 1;

        await expect(
            viewIndex(index, collection, pageNumber),
        ).rejects.toThrowError("Cannot start viewIndex");
    });

    test("Should throw error for invalid page number", async () => {
        checkIndex.mockImplementation(() => null);
        checkCollection.mockImplementation(() => null);
        checkPageNumber.mockImplementation(() => new Error("Error"));

        const index = "indexname";
        const collection = "collectionname";
        const pageNumber = 1;

        await expect(
            viewIndex(index, collection, pageNumber),
        ).rejects.toThrowError("Cannot start viewIndex:Error");
    });
});

describe("Function errors", () => {
    test("Should throw error if sidecar lookup fails", async () => {
        checkCollection.mockImplementation(() => null);
        checkIndex.mockImplementation(() => null);
        checkPageNumber.mockImplementation(() => null);
        env.mockImplementation(() => 10); // Assuming page size is 10
        readIndexRows.mockImplementation(() => {
            throw new Error("Error");
        });

        const index = "indexname";
        const collection = "collectionname";
        const pageNumber = 1;

        await expect(
            viewIndex(index, collection, pageNumber),
        ).rejects.toThrowError("Cannot run viewIndex:Error");
    });
});
