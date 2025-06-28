import { vi, beforeEach, describe, test, expect } from "vitest";
import { viewDocument } from "../../lib/viewDocument";

let checkCollection = vi.spyOn(
    await import("../../utils/checks"),
    "checkCollection",
);
let checkDocument = vi.spyOn(
    await import("../../utils/checks"),
    "checkDocument",
);
let readfile = vi.spyOn(await import("../../utils/fs"), "readfile");

beforeEach(() => {
    checkCollection.mockClear();
    checkDocument.mockClear();
    readfile.mockClear();
});

describe("Normal run", () => {
    test("Should view document if no errors", async () => {
        checkCollection.mockImplementation(() => null);
        checkDocument.mockImplementation(() => null);
        const fakeDocumentContent = { prop1: "value1", prop2: "value2" };
        readfile.mockImplementation(() => JSON.stringify(fakeDocumentContent));

        const collection = "collectionname";
        const document = "doc1";
        const result = await viewDocument(collection, document);

        expect(result).toEqual(fakeDocumentContent);
        expect(readfile).toHaveBeenCalledWith(collection, `${document}.json`);
    });
});

describe("Initialization error", () => {
    test("Should throw error for invalid collection", async () => {
        checkCollection.mockImplementation(() => new Error("Error"));

        const collection = "collectionname";
        const document = "doc1";

        await expect(viewDocument(collection, document)).rejects.toThrowError(
            "Cannot start viewDocument:Error",
        );
    });

    test("Should throw error for invalid document", async () => {
        checkCollection.mockImplementation(() => null);
        checkDocument.mockImplementation(() => new Error("Error"));

        const collection = "collectionname";
        const document = "doc1";

        await expect(viewDocument(collection, document)).rejects.toThrowError(
            "Cannot start viewDocument:Error",
        );
    });
});

describe("Function errors", () => {
    test("Should throw error if readfile fails", async () => {
        checkCollection.mockImplementation(() => null);
        checkDocument.mockImplementation(() => null);
        readfile.mockImplementation(() => {
            throw new Error("Error");
        });

        const collection = "collectionname";
        const document = "doc1";

        await expect(viewDocument(collection, document)).rejects.toThrowError(
            "Cannot run viewDocument:Error",
        );
    });
});
