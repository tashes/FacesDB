import { vi, beforeEach, describe, test, expect } from "vitest";
import { deleteCollection } from "../../lib/deleteCollection";

let checkCollection = vi.spyOn(
    await import("../../utils/checks"),
    "checkCollection",
);
let rm = vi.spyOn(await import("../../utils/fs"), "rm");

beforeEach(() => {
    checkCollection.mockClear();
    rm.mockClear();
});

describe("Normal run", () => {
    test("Should delete collection if no errors", async () => {
        checkCollection.mockImplementation(() => null);
        rm.mockImplementation(() => {});

        let collection = "collectionname";

        await deleteCollection(collection);

        expect(rm).toHaveBeenCalledWith(collection);
    });
});

describe("Initialization error", () => {
    test("Should throw error for invalid collection", async () => {
        checkCollection.mockImplementation(() => new Error("Error"));

        let collection = "collectionname";

        await expect(deleteCollection(collection)).rejects.toThrowError(
            "Cannot start deleteCollection:Error",
        );
    });
});

describe("Function errors", () => {
    test("Should throw error if rm fails", async () => {
        checkCollection.mockImplementation(() => null);
        rm.mockImplementation(() => {
            throw new Error("Error");
        });

        let collection = "collectionname";

        await expect(deleteCollection(collection)).rejects.toThrowError(
            "Cannot run deleteCollection:Error",
        );
    });
});
