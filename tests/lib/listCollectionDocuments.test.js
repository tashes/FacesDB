import { vi, beforeEach, describe, test, expect } from "vitest";
import { listCollectionDocuments } from "../../lib/listCollectionDocuments";

let checkCollection = vi.spyOn(
    await import("../../utils/checks"),
    "checkCollection",
);
let readdir = vi.spyOn(await import("../../utils/fs"), "readdir");

beforeEach(() => {
    checkCollection.mockClear();
    readdir.mockClear();
});

describe("Normal run", () => {
    test("Should list documents in collection", async () => {
        checkCollection.mockImplementation(() => null);
        const mockDocuments = [
            "F647C977aBDD53D8eDdccDDd.json",
            "Ba9DEcc6eD0Ad34e51482f3d.json",
            "indexone.json",
        ];
        readdir.mockImplementation(() => mockDocuments);

        const collection = "collectionname";
        const documents = await listCollectionDocuments(collection);

        expect(documents).toEqual([
            "F647C977aBDD53D8eDdccDDd.json",
            "Ba9DEcc6eD0Ad34e51482f3d.json",
        ]);
        expect(readdir).toHaveBeenCalledWith(collection);
    });
});

describe("Initialization error", () => {
    test("Should throw error for invalid collection", async () => {
        checkCollection.mockImplementation(() => new Error("Error"));
        const collection = "collectionname";

        await expect(listCollectionDocuments(collection)).rejects.toThrowError(
            "Cannot start viewCollectionDocuments:Error",
        );
    });
});

describe("Function errors", () => {
    test("Should throw error if readdir fails", async () => {
        checkCollection.mockImplementation(() => null);
        readdir.mockImplementation(() => {
            throw new Error("Error");
        });

        const collection = "collectionname";

        await expect(listCollectionDocuments(collection)).rejects.toThrowError(
            "Cannot run viewCollectionDocuments:Error",
        );
    });
});
