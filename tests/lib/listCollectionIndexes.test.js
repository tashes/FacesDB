import { vi, beforeEach, describe, test, expect } from "vitest";
import { listCollectionIndexes } from "../../lib/listCollectionIndexes";

let checkCollection = vi.spyOn(
    await import("../../utils/checks"),
    "checkCollection",
);
let isFile = vi.spyOn(await import("../../utils/fs"), "isFile");
let readdir = vi.spyOn(await import("../../utils/fs"), "readdir");

beforeEach(() => {
    checkCollection.mockClear();
    isFile.mockClear();
    readdir.mockClear();
});

describe("Normal run", () => {
    test("Should list indexes in collection", async () => {
        checkCollection.mockImplementation(() => null);
        const mockIndexes = [
            "indexone.json",
            "indextwo.json",
            "F647C977aBDD53D8eDdccDDd.json",
            "Ba9DEcc6eD0Ad34e51482f3d.json",
        ];
        isFile.mockImplementation(() => true);
        readdir.mockImplementation(() => mockIndexes);

        const collection = "collectionname";
        const indexes = await listCollectionIndexes(collection);

        // Assuming INDEXNAME is expected to match the whole filename or part of it
        expect(indexes).toEqual(["indexone", "indextwo"]);
        expect(readdir).toHaveBeenCalledWith(collection);
    });
});

describe("Initialization error", () => {
    test("Should throw error for invalid collection", async () => {
        checkCollection.mockImplementation(() => new Error("Error"));
        const collection = "collectionname";

        await expect(listCollectionIndexes(collection)).rejects.toThrowError(
            "Cannot start viewCollectionDocuments:Error",
        );
    });
});

describe("Function errors", () => {
    test("Should throw error if isFile fails", async () => {
        checkCollection.mockImplementation(() => null);
        const mockIndexes = [
            "indexone.json",
            "indextwo.json",
            "F647C977aBDD53D8eDdccDDd.json",
            "Ba9DEcc6eD0Ad34e51482f3d.json",
        ];
        isFile.mockImplementation(() => {
            throw new Error("Error");
        });
        readdir.mockImplementation(() => mockIndexes);

        const collection = "collectionname";

        await expect(listCollectionIndexes(collection)).rejects.toThrowError(
            "Cannot run viewCollectionDocuments:Error",
        );
    });

    test("Should throw error if readdir fails", async () => {
        checkCollection.mockImplementation(() => null);
        isFile.mockImplementation(() => true);
        readdir.mockImplementation(() => {
            throw new Error("Error");
        });

        const collection = "collectionname";

        await expect(listCollectionIndexes(collection)).rejects.toThrowError(
            "Cannot run viewCollectionDocuments:Error",
        );
    });
});
