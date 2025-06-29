import { vi, beforeEach, describe, test, expect } from "vitest";
import { createCollection } from "../../lib/createCollection";

let checkCollection = vi.spyOn(
    await import("../../utils/checks"),
    "checkCollection",
);
let createFolder = vi.spyOn(await import("../../utils/fs"), "createFolder");
let exists = vi.spyOn(await import("../../utils/fs"), "exists");

beforeEach(() => {
    checkCollection.mockClear();
    createFolder.mockClear();
    exists.mockClear();
});

describe("Normal run", () => {
    test("Should create collection if it does not exist", async () => {
        checkCollection.mockImplementation(() => null);
        exists.mockImplementation(() => false);
        createFolder.mockImplementation(() => {});

        const collection = "newCollection";
        await createCollection(collection);

        expect(exists).toHaveBeenCalledWith(collection);
        expect(createFolder).toHaveBeenCalledWith(collection);
    });
});

describe("Initialization error", () => {
    test("Should throw error for invalid collection", async () => {
        checkCollection.mockImplementation(() => new Error("Error"));

        const collection = "invalidCollection";

        await expect(createCollection(collection)).rejects.toThrowError(
            "Cannot start createCollection:Error",
        );
    });
});

describe("Function errors", () => {
    test("Should throw error if collection already exists", async () => {
        checkCollection.mockImplementation(() => null);
        exists.mockImplementation(() => true);

        const collection = "existingCollection";

        await expect(createCollection(collection)).rejects.toThrowError(
            "Cannot run createCollection:Collection exists",
        );
    });

    test("Should throw error if createFolder fails", async () => {
        checkCollection.mockImplementation(() => null);
        exists.mockImplementation(() => false);
        createFolder.mockImplementation(() => {
            throw new Error("Error");
        });

        const collection = "newCollection";

        await expect(createCollection(collection)).rejects.toThrowError(
            "Cannot run createCollection:Error",
        );
    });
});
